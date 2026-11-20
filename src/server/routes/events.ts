/** Database-authorized, bounded SSE signals. Reconnection deliberately refreshes snapshots. */
import type { FastifyInstance, FastifyRequest } from "fastify";
import "../plugins-types.ts";
import { DomainError } from "../../shared/errors.ts";
import {
  subscribe,
  subscribeRecovery,
  replaySince,
  BACKLOG_LIMIT,
  type SseEvent,
} from "../services/events.service.ts";
import {
  currentEventIdentity,
  eventReadable,
  type EventCredential,
  type EventIdentity,
} from "../services/events-access.ts";
import type { Actor } from "../permission/actor.ts";
import { closeRealtimeRedis } from "../services/realtime-redis.ts";
import * as presence from "../services/presence.service.ts";

declare module "fastify" {
  interface FastifyRequest {
    actor?: Actor;
  }
}
export async function registerEventRoutes(app: FastifyInstance): Promise<void> {
  const shutdown = new Set<() => void>();
  const presenceCleanup = new Set<Promise<void>>();
  app.addHook("onClose", async () => {
    await closeRealtimeRedis();
  });
  app.addHook("preClose", async () => {
    for (const close of shutdown) close();
    await Promise.all(presenceCleanup);
  });
  const credentialOf = async (
    req: FastifyRequest,
  ): Promise<EventCredential> => {
    const bearer = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
    const credential = {
      memberId: req.actor?.memberId ?? "",
      sessionToken: req.sessionToken,
      bearer,
      ip: req.ip,
    };
    // This route remains session authenticated; Bearer-only access is not silently introduced.
    if (!credential.memberId || !credential.sessionToken)
      throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    credential.bearer = undefined;
    try {
      await currentEventIdentity(credential);
      return credential;
    } catch {
      throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    }
  };
  const fingerprint = (identity: EventIdentity) =>
    JSON.stringify(identity, (_key, value) =>
      value instanceof Set
        ? [...value].sort()
        : value instanceof Map
          ? [...value]
              .map(([key, values]) => [
                key,
                values instanceof Set ? [...values].sort() : values,
              ])
              .sort(([a], [b]) => String(a).localeCompare(String(b)))
          : value,
    );
  async function projectCurrent(
    credential: EventCredential,
    events: SseEvent[],
  ): Promise<SseEvent[]> {
    let identity = await currentEventIdentity(credential);
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = fingerprint(identity);
      const visible: SseEvent[] = [];
      for (const event of events)
        if (await eventReadable(identity, event)) visible.push(event);
      const latest = await currentEventIdentity(credential);
      // Always project again with the newly loaded actor after resource awaits. If authorization
      // changes while projecting that complete batch, retry it (bounded); never return old items.
      if (attempt > 0 && before === fingerprint(latest)) return visible;
      identity = latest;
    }
    throw new Error(
      "Event authorization changed during projection; refresh required",
    );
  }
  app.get("/api/v1/events", async (req, reply) => {
    const credential = await credentialOf(req);
    const identity = await currentEventIdentity(credential);
    const rawLastEventId = req.headers["last-event-id"];
    const lastEventId = typeof rawLastEventId === "string" && /^\d+$/u.test(rawLastEventId) && Number.isSafeInteger(Number(rawLastEventId))
      ? Number(rawLastEventId) : null;
    let replaying = lastEventId !== null;
    const duringReplay: SseEvent[] = [];
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    let closed = false,
      blocked = false,
      running = false;
    const pending: SseEvent[] = [];
    let finish!: () => void;
    const disconnected = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let presenceReady: Promise<void> = Promise.resolve();
    function cleanup() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      unsubscribeRecovery();
      pending.length = 0;
      duringReplay.length = 0;
      reply.raw.off("drain", drain);
      reply.raw.off("close", cleanup);
      reply.raw.off("error", cleanup);
      req.raw.off("aborted", cleanup);
      shutdown.delete(close);
      const task = presenceReady
        .then(() => presence.presenceDisconnected(credential.memberId))
        .catch(() => {});
      presenceCleanup.add(task);
      void task.finally(() => {
        presenceCleanup.delete(task);
        finish();
      });
    }
    function close() {
      cleanup();
      reply.raw.end();
    }
    function drop() {
      cleanup();
      // 清除 EventSource 过期游标，避免下一次重连重复 dropped。
      reply.raw.end("event: dropped\ndata: {}\nid:\n\n");
    }
    async function pump() {
      if (running || closed || blocked || replaying) return;
      running = true;
      try {
        while (!closed && !blocked && pending.length) {
          const event = pending.shift()!;
          const visible = await projectCurrent(credential, [event]);
          if (closed) return;
          if (visible.length)
            blocked = !reply.raw.write(
              `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`,
            );
        }
      } catch (error) {
        if (
          error instanceof DomainError &&
          (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")
        )
          close();
        else drop();
      } finally {
        running = false;
      }
    }
    function enqueue(event: SseEvent) {
      if (
        closed ||
        (event.memberId !== null && event.memberId !== credential.memberId)
      )
        return;
      if (replaying) {
        duringReplay.push(event);
        if (duringReplay.length > BACKLOG_LIMIT) drop();
        return;
      }
      pending.push(event);
      if (pending.length > BACKLOG_LIMIT) {
        drop();
        return;
      }
      void pump();
    }
    function drain() {
      if (closed) return;
      blocked = false;
      void pump();
    }
    const unsubscribe = subscribe(enqueue);
    const unsubscribeRecovery = subscribeRecovery(() => {
      void (async () => {
        await currentEventIdentity(credential);
        if (closed) return;
        drop();
      })().catch(close);
    });
    let heartbeatRunning = false;
    const heartbeat = setInterval(() => {
      if (closed || heartbeatRunning) return;
      heartbeatRunning = true;
      void (async () => {
        const identity = await currentEventIdentity(credential);
        if (closed) return;
        await presence.touchPresence(credential.memberId, identity.actor);
        if (!closed && !blocked) blocked = !reply.raw.write(":ping\n\n");
      })()
        .catch(close)
        .finally(() => {
          heartbeatRunning = false;
        });
    }, 25000);
    reply.raw.on("drain", drain);
    reply.raw.once("close", cleanup);
    reply.raw.once("error", cleanup);
    req.raw.once("aborted", cleanup);
    shutdown.add(close);
    blocked = !reply.raw.write(":ok\n\n");
    presenceReady = presence.presenceConnected(identity.actor).catch(() => {});
    if (lastEventId !== null) {
      const replay = await replaySince(lastEventId, credential.memberId);
      if (closed) return;
      if (replay.gone || replay.hasMore) { drop(); return; }
      // 实时帧只在历史帧之后进入同一授权队列，内部 scope 不进入 SSE 帧。
      const replayCursor = replay.nextCursor ?? Math.max(lastEventId, ...replay.items.map(item => item.id));
      const buffered = duringReplay.splice(0).filter(event => event.id > replayCursor);
      replaying = false;
      for (const event of replay.items) enqueue({ ...event, memberId: credential.memberId });
      for (const event of buffered) enqueue(event);
    } else if (rawLastEventId !== undefined) { drop(); return; }
    await disconnected;
  });
  app.get("/api/v1/presence", async (req) => {
    await credentialOf(req);
    const members = await presence.listOnline();
    return { online: members, count: members.length };
  });
  app.post("/api/v1/events/replay", async (req, reply) => {
    const credential = await credentialOf(req);
    const since = Number((req.query as { since?: string }).since);
    if (!Number.isSafeInteger(since) || since < 0)
      throw new DomainError("VALIDATION", "since 必须是非负整数游标", null);
    const result = await replaySince(since, credential.memberId);
    if (result.gone)
      return reply.status(410).send({
        code: "CONFLICT",
        message: "事件窗口已过期，请全量刷新",
        details: null,
      });
    try {
      const visible = await projectCurrent(credential, result.items.map(event => ({ ...event, memberId: credential.memberId })));
      const items = visible.map(({ id, event, data }) => ({ id, event, data }));
      return { items, hasMore: result.hasMore, nextCursor: result.nextCursor };
    } catch (error) {
      if (
        error instanceof DomainError &&
        (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")
      )
        throw error;
      return reply.status(410).send({
        code: "CONFLICT",
        message: "事件无法可靠补取，请全量刷新",
        details: null,
      });
    }
  });
}
