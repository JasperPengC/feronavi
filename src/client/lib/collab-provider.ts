import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { ApiError, apiGet, apiPost } from "./api.ts";
import { applyTextValue } from "./collab-text.ts";
import { createCollabOutbox, type CollabOutbox } from "./collab-outbox.ts";

type CollabState = { roomId: string; baseRevisionId: string | null; sequence: number; stateBase64: string };
type CollabMember = { memberId: string; clientId: string; lastSeenAt: string };
type CollabStatus = "idle" | "joining" | "ready" | "error";

function decode(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function clientIdentifier(accountId: string): string {
  const key = `feronavi:collab:client:${accountId}`;
  try {
    const saved = localStorage.getItem(key);
    if (saved) return saved;
    const created = typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, created);
    return created;
  } catch {
    return typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function operationIdentifier(): string {
  return typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useCollabDocument(pageId: string | null, initialContent: string, enabled: boolean, accountId: string) {
  const [content, setContentState] = useState(initialContent);
  const [status, setStatus] = useState<CollabStatus>("idle");
  const [baseRevisionId, setBaseRevisionId] = useState<string | null>(null);
  const [sequence, setSequence] = useState(0);
  const [members, setMembers] = useState<CollabMember[]>([]);
  const docRef = useRef<Y.Doc | null>(null);
  const clientIdRef = useRef({ accountId, clientId: clientIdentifier(accountId) });
  if (clientIdRef.current.accountId !== accountId) {
    clientIdRef.current = { accountId, clientId: clientIdentifier(accountId) };
  }
  const pendingRef = useRef(Promise.resolve());
  const outboxRef = useRef<CollabOutbox | null>(null);
  const desiredContentRef = useRef(initialContent);

  useEffect(() => {
    desiredContentRef.current = initialContent;
    if (!enabled || status === "ready") return;
    const doc = docRef.current;
    if (!doc || !initialContent) return;
    const text = doc.getText("content");
    if (text.toString()) return;
    doc.transact(() => text.insert(0, initialContent), "bootstrap");
    setContentState(initialContent);
  }, [enabled, initialContent, status]);

  useEffect(() => {
    if (!enabled || !pageId) {
      setStatus("idle");
      docRef.current?.destroy();
      docRef.current = null;
      return;
    }
    let cancelled = false;
    const clientId = clientIdRef.current.clientId;
    const base = `/api/v1/collaboration/rooms/PAGE/${pageId}`;
    const roomKey = `PAGE/${pageId}`;
    const outbox = outboxRef.current ?? (outboxRef.current = createCollabOutbox());
    const doc = new Y.Doc();
    docRef.current = doc;
    const text = doc.getText("content");
    let hydrating = true;
    let eventSource: EventSource | undefined;
    let roomId: string | null = null;

    const refreshMembers = async () => {
      const response = await apiGet<{ members: CollabMember[] }>(base);
      if (!cancelled) setMembers(response.members);
    };

    const refresh = async () => {
      const state = await apiGet<CollabState>(`${base}/state`);
      if (cancelled) return;
      roomId = state.roomId;
      setBaseRevisionId(state.baseRevisionId);
      setSequence(state.sequence);
      if (state.stateBase64) Y.applyUpdate(doc, decode(state.stateBase64), "remote");
      if (!text.toString() && initialContent) text.insert(0, initialContent, "bootstrap");
      setContentState(text.toString());
      desiredContentRef.current = text.toString();
    };

    const applyRemoteState = async (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data as string) as { roomId?: string; clientId?: string; sequence?: number };
        if (payload.roomId !== undefined && payload.roomId !== roomId) return;
        if (payload.clientId === clientId) return;
        const state = await apiGet<CollabState>(`${base}/state`);
        if (cancelled) return;
        setBaseRevisionId(state.baseRevisionId);
        setSequence(state.sequence);
        if (state.stateBase64) Y.applyUpdate(doc, decode(state.stateBase64), "remote");
        await refreshMembers();
      } catch { /* 单条协作事件损坏时，等待下一条事件或用户刷新 */ }
    };

    const sendEntry = async (entry: Awaited<ReturnType<CollabOutbox["list"]>>[number]) => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await apiPost(`${base}/updates`, {
            clientId: entry.clientId,
            operationId: entry.operationId,
            updateBase64: entry.updateBase64,
          });
          await outbox.remove(entry.operationId);
          return;
        } catch (error) {
          lastError = error;
          if (error instanceof ApiError && error.status < 500 && error.status !== 429) throw error;
          if (attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, 250 * (2 ** attempt)));
        }
      }
      throw lastError;
    };
    const queuedOperations = new Set<string>();
    const queueEntry = (entry: Awaited<ReturnType<CollabOutbox["list"]>>[number], persist: boolean) => {
      if (queuedOperations.has(entry.operationId)) return;
      queuedOperations.add(entry.operationId);
      pendingRef.current = pendingRef.current.then(async () => {
        if (persist) await outbox.put(entry);
        await sendEntry(entry);
        if (!cancelled) setStatus("ready");
      }).catch(() => { if (!cancelled) setStatus("error"); }).finally(() => queuedOperations.delete(entry.operationId));
    };
    let replaying = false;
    const flushPersisted = async () => {
      if (replaying) return;
      replaying = true;
      try {
        const entries = await outbox.list(roomKey, clientId);
        for (const entry of entries) {
          Y.applyUpdate(doc, decode(entry.updateBase64), "outbox");
          queueEntry(entry, false);
        }
        if (entries.length) {
          desiredContentRef.current = text.toString();
          setContentState(text.toString());
        }
      } finally { replaying = false; }
    };
    const onOnline = () => { void flushPersisted(); };
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      setContentState(text.toString());
      if (hydrating || origin === "remote" || origin === "bootstrap" || origin === "outbox") return;
      queueEntry({
        roomKey,
        clientId,
        operationId: operationIdentifier(),
        updateBase64: encode(update),
        createdAt: Date.now(),
      }, true);
    };
    doc.on("update", onUpdate);

    void (async () => {
      try {
        setStatus("joining");
        await apiPost(`${base}/join`, { clientId });
        await refresh();
        await refreshMembers();
        await flushPersisted();
        hydrating = false;
        if (desiredContentRef.current !== text.toString()) {
          applyTextValue(text, desiredContentRef.current);
        }
        if (typeof EventSource !== "undefined") {
          eventSource = new EventSource("/api/v1/events", { withCredentials: true });
          eventSource.addEventListener("collab.update", (event) => { void applyRemoteState(event as MessageEvent); });
          eventSource.addEventListener("collab.published", (event) => { void applyRemoteState(event as MessageEvent); });
          eventSource.addEventListener("collab.presence", () => { void refreshMembers(); });
        }
        setStatus("ready");
      } catch {
        hydrating = false;
        setStatus("error");
      }
    })();
    window.addEventListener("online", onOnline);

    const heartbeat = window.setInterval(() => {
      void apiPost(`${base}/heartbeat`, { clientId }).then(refreshMembers).catch(() => setStatus("error"));
    }, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(heartbeat);
      eventSource?.close();
      window.removeEventListener("online", onOnline);
      void apiPost(`${base}/leave`, { clientId }).catch(() => {});
      doc.off("update", onUpdate);
      doc.destroy();
      if (docRef.current === doc) docRef.current = null;
    };
  }, [accountId, enabled, pageId]);

  const setContent = useCallback((next: string) => {
    desiredContentRef.current = next;
    setContentState(next);
    const doc = docRef.current;
    if (!doc) return;
    const text = doc.getText("content");
    doc.transact(() => applyTextValue(text, next), "local");
  }, []);

  const flush = useCallback(async () => { await pendingRef.current; }, []);
  return { content, status, baseRevisionId, sequence, members, setContent, flush };
}
