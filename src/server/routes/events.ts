/**
 * SSE 事件流（W5，REST 7c）
 *
 * 协议要点：
 *   - `text/event-stream`，每条事件带 `id: <cursor>`，客户端 Last-Event-ID 即游标
 *   - 心跳注释行（:ping）每 25s 一条，防代理与负载均衡掐空闲连接
 *   - 积压 > 100 条（客户端消费太慢）→ 发 `dropped` 后**主动断开**，逼客户端全量刷新
 *   - 断开时机：客户端 abort 或服务端 shutdown；不遗留监听器
 */
import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { DomainError } from "../../shared/errors.ts";
import {
  subscribe, replaySince, BACKLOG_LIMIT, type SseEvent,
} from "../services/events.service.ts";
import type { Actor } from "../permission/actor.ts";
import * as presence from "../services/presence.service.ts";

declare module "fastify" {
  interface FastifyRequest { actor?: Actor }
}

export async function registerEventRoutes(app: FastifyInstance): Promise<void> {
  const actorOf = (req: { actor?: Actor }): Actor => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };

  app.get("/api/v1/events", async (req, reply) => {
    const actor = actorOf(req);
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",          // 提示反代不缓冲（nginx 配置里也已关）
    });
    let closed = false;
    let blocked = false;
    const pending: SseEvent[] = [];
    let finish!: () => void;
    const disconnected = new Promise<void>((resolve) => { finish = resolve; });

    const writeEvent = (e: SseEvent) => {
      // write(false) 的当前帧已经进入 Node 缓冲；只排队后续事件，drain 时不能重发它。
      blocked = !reply.raw.write(`id: ${e.id}\nevent: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
    };

    const send = (e: SseEvent) => {
      if (closed || (e.memberId !== null && e.memberId !== actor.memberId)) return;
      if (blocked) {
        pending.push(e);
        if (pending.length > BACKLOG_LIMIT) {
          // 只统计真正尚未写出的事件；快速消费者不会因累计事件数超过阈值掉线。
          cleanup();
          reply.raw.end(`event: dropped\ndata: {}\nid: ${e.id}\n\n`);
        }
        return;
      }
      writeEvent(e);
    };

    const drain = () => {
      if (closed) return;
      blocked = false;
      while (!blocked && pending.length > 0) writeEvent(pending.shift()!);
    };

    const unsubscribe = subscribe(send);
    const heartbeat = setInterval(() => {
      if (!closed) {
        void presence.touchPresence(actor.memberId);
        if (!blocked) blocked = !reply.raw.write(":ping\n\n");
      }
    }, 25_000);

    function cleanup() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      pending.length = 0;
      reply.raw.off("drain", drain);
      reply.raw.off("close", cleanup);
      reply.raw.off("error", cleanup);
      req.raw.off("aborted", cleanup);
      void presence.presenceDisconnected(actor.memberId);
      finish();
    }
    reply.raw.on("drain", drain);
    reply.raw.once("close", cleanup);
    reply.raw.once("error", cleanup);
    req.raw.once("aborted", cleanup);
    // 初始 comment 行：确认连接已建立（部分客户端要收到首字节才 resolve）
    blocked = !reply.raw.write(":ok\n\n");
    // presence：先订阅再标记在线，这样自己也能收到自己的 online 事件（首屏状态一致）
    void presence.presenceConnected(actor);
    // ⚠️ 客户端断开时**必须让 handler 返回**：返回 promise 永不 resolve 的话，
    //    app.close() 会一直等待 inflight 请求 —— 测试进程挂起、finally 清理全部
    //    跳过（实测踩到，残留滚雪球）。连接关闭 → cleanup → resolve。
    await disconnected;
  });

  /**
   * 在线成员列表（Round 48）：SSE 是"变更信号"，首屏仍需要一个可查询的初始快照 ——
   * 规范 7c 只列了事件；该 GET 是补充（前端首屏 + 运维排查都靠它）。
   */
  app.get("/api/v1/presence", async (req) => {
    actorOf(req);
    const members = await presence.listOnline();
    return { online: members, count: members.length };
  });

  /** 断线补取：`?since=<cursor>`（REST 7c） */
  app.post("/api/v1/events/replay", async (req, reply) => {
    const actor = actorOf(req);
    const q = req.query as { since?: string };
    const since = Number(q.since);
    if (!Number.isFinite(since) || since < 0) {
      throw new DomainError("VALIDATION", "since 必须是非负数字游标", null);
    }
    const r = await replaySince(since, actor.memberId);
    if (r.gone) {
      // ⚠️ 规范 7c 明确要求 **410 Gone**（不是 409）—— 告知客户端
      // 「这个 cursor 永远补不回来了，只能全量刷新」。
      // CONFLICT(409) 表示可重试的冲突，语义不对，所以这里绕开统一映射。
      return reply.status(410).send({
        code: "CONFLICT", message: "事件窗口已过期，请全量刷新", details: null,
      });
    }
    return { items: r.items, hasMore: r.hasMore };
  });
}
