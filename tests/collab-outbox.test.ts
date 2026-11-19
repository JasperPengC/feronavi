import { describe, expect, it } from "vitest";
import { indexedDB } from "fake-indexeddb";
import {
  createCollabOutbox,
  type CollabOutboxEntry,
} from "../src/client/lib/collab-outbox.ts";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const entry = (
  operationId: string,
  createdAt: number,
  roomKey = "PAGE/page-1",
): CollabOutboxEntry => ({
  roomKey,
  clientId: "client-1",
  operationId,
  updateBase64: `update-${operationId}`,
  createdAt,
});

describe("collab outbox", () => {
  it("使用 IndexedDB 持久化，并在确认后移除已发送 update", async () => {
    const namespace = `test-indexeddb-${Date.now()}-${Math.random()}`;
    const first = createCollabOutbox({
      indexedDB,
      localStorage: new MemoryStorage(),
      namespace,
    });
    await first.put(entry("idb-op-1", 10));
    await first.put(entry("idb-op-2", 20));

    const afterReload = createCollabOutbox({
      indexedDB,
      localStorage: new MemoryStorage(),
      namespace,
    });
    await expect(afterReload.list("PAGE/page-1", "client-1")).resolves.toEqual([
      entry("idb-op-1", 10),
      entry("idb-op-2", 20),
    ]);
    await afterReload.remove("idb-op-1");
    await expect(first.list("PAGE/page-1", "client-1")).resolves.toEqual([
      entry("idb-op-2", 20),
    ]);
  });

  it("在重新创建 store 后保留 update，并按创建顺序重放", async () => {
    const storage = new MemoryStorage();
    const first = createCollabOutbox({
      indexedDB: undefined,
      localStorage: storage,
      namespace: "test-outbox",
    });
    await first.put(entry("op-2", 20));
    await first.put(entry("op-1", 10));

    const second = createCollabOutbox({
      indexedDB: undefined,
      localStorage: storage,
      namespace: "test-outbox",
    });
    await expect(second.list("PAGE/page-1", "client-1")).resolves.toMatchObject(
      [{ operationId: "op-1" }, { operationId: "op-2" }],
    );
  });

  it("确认成功后只删除对应 operation，其他 update 保留", async () => {
    const storage = new MemoryStorage();
    const outbox = createCollabOutbox({
      indexedDB: undefined,
      localStorage: storage,
      namespace: "test-outbox-ack",
    });
    await outbox.put(entry("op-1", 10));
    await outbox.put(entry("op-2", 20));
    await outbox.remove("op-1");

    await expect(outbox.list("PAGE/page-1", "client-1")).resolves.toEqual([
      entry("op-2", 20),
    ]);
  });

  it("按房间和客户端隔离待发送 update", async () => {
    const storage = new MemoryStorage();
    const outbox = createCollabOutbox({
      indexedDB: undefined,
      localStorage: storage,
      namespace: "test-outbox-scope",
    });
    await outbox.put(entry("op-1", 10));
    await outbox.put(entry("op-2", 20, "PAGE/page-2"));
    await outbox.put({ ...entry("op-3", 30), clientId: "client-2" });

    await expect(outbox.list("PAGE/page-1", "client-1")).resolves.toEqual([
      entry("op-1", 10),
    ]);
  });

  it("IndexedDB 恢复后迁移降级队列并清理旧存储", async () => {
    const storage = new MemoryStorage();
    const namespace = "test-outbox-migration";
    const fallback = createCollabOutbox({
      indexedDB: undefined,
      localStorage: storage,
      namespace,
    });
    await fallback.put(entry("legacy-op", 10));

    const recovered = createCollabOutbox({
      indexedDB,
      localStorage: storage,
      namespace,
    });
    await expect(recovered.list("PAGE/page-1", "client-1")).resolves.toEqual([
      entry("legacy-op", 10),
    ]);

    const afterMigration = createCollabOutbox({
      indexedDB: undefined,
      localStorage: storage,
      namespace,
    });
    await expect(
      afterMigration.list("PAGE/page-1", "client-1"),
    ).resolves.toEqual([]);
  });
});
