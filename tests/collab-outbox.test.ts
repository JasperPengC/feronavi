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
  it("同账号前缀恢复多个标签页队列，同时隔离其他账号及相似前缀", async () => {
    const outbox = createCollabOutbox({ indexedDB, localStorage: new MemoryStorage(), namespace: `tabs-${Date.now()}` });
    await outbox.put({ ...entry("a", 1), clientId: "account-a.tab-1" });
    await outbox.put({ ...entry("b", 2), clientId: "account-a.tab-2" });
    await outbox.put({ ...entry("c", 3), clientId: "account-b.tab-1" });
    await outbox.put({ ...entry("d", 4), clientId: "account-ab.tab-1" });
    expect((await outbox.list("PAGE/page-1", "account-a")).map(entry => entry.operationId)).toEqual(["a", "b"]);
    expect((await outbox.list("PAGE/page-1", "account-a.tab-1")).map(entry => entry.operationId)).toEqual(["a"]);
  });
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

  it("IndexedDB 被拒绝时读取降级队列不会提前删除尚未确认的操作", async () => {
    const storage = new MemoryStorage();
    const unavailable = { open: () => { throw new Error("IndexedDB denied"); } } as unknown as IDBFactory;
    const outbox = createCollabOutbox({ indexedDB: unavailable, localStorage: storage, namespace: "denied" });
    await outbox.put(entry("pending", 10));
    await expect(outbox.list("PAGE/page-1", "client-1")).resolves.toEqual([entry("pending", 10)]);
    const reopened = createCollabOutbox({ indexedDB: unavailable, localStorage: storage, namespace: "denied" });
    await expect(reopened.list("PAGE/page-1", "client-1")).resolves.toEqual([entry("pending", 10)]);
    await outbox.remove("pending");
    await expect(outbox.list("PAGE/page-1", "client-1")).resolves.toEqual([]);
  });

  it("升级旧版 localStorage 数组时保留操作，重新打开后仍可按确认删除", async () => {
    const storage = new MemoryStorage();
    const unavailable = { open: () => { throw new Error("IndexedDB denied"); } } as unknown as IDBFactory;
    const options = { indexedDB: unavailable, localStorage: storage, namespace: "legacy-array" };
    storage.setItem(options.namespace, JSON.stringify([entry("legacy", 10), null, { invalid: true }]));
    const first = createCollabOutbox(options);
    await expect(first.list("PAGE/page-1", "client-1")).resolves.toEqual([entry("legacy", 10)]);
    expect(storage.getItem(options.namespace)).toBeNull();
    const reopened = createCollabOutbox(options);
    await expect(reopened.list("PAGE/page-1", "client-1")).resolves.toEqual([entry("legacy", 10)]);
    await reopened.remove("legacy");
    await expect(first.list("PAGE/page-1", "client-1")).resolves.toEqual([]);
  });

  it("多个标签的降级队列互不覆盖，确认操作不会复活其他标签已移除的操作", async () => {
    const storage = new MemoryStorage();
    const unavailable = { open: () => { throw new Error("IndexedDB denied"); } } as unknown as IDBFactory;
    const options = { indexedDB: unavailable, localStorage: storage, namespace: "fallback-tabs" };
    const first = createCollabOutbox(options);
    const second = createCollabOutbox(options);
    await first.put(entry("first", 10));
    await second.put(entry("second", 20));
    await expect(first.list("PAGE/page-1", "client-1")).resolves.toEqual([entry("first", 10), entry("second", 20)]);
    await second.remove("first");
    await first.put(entry("third", 30));
    await expect(createCollabOutbox(options).list("PAGE/page-1", "client-1")).resolves.toEqual([entry("second", 20), entry("third", 30)]);
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
