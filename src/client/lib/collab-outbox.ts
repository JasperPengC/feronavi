/**
 * 浏览器端协作 update outbox。
 *
 * IndexedDB 是首选，localStorage 仅作为旧浏览器/隐私模式降级；两者都只保存
 * 尚未被服务端确认的 update，不参与业务数据或鉴权信息存储。
 */
export interface CollabOutboxEntry {
  roomKey: string;
  clientId: string;
  operationId: string;
  updateBase64: string;
  createdAt: number;
}

interface OutboxOptions {
  indexedDB?: IDBFactory;
  localStorage?: Storage;
  namespace?: string;
}

interface CollabOutbox {
  put(entry: CollabOutboxEntry): Promise<void>;
  list(roomKey: string, clientId: string): Promise<CollabOutboxEntry[]>;
  remove(operationId: string): Promise<void>;
}

const DATABASE_NAME = "feronavi-collab";
const STORE_NAME = "outbox";
const DEFAULT_NAMESPACE = "feronavi:collab:outbox";

function keyOf(
  entry: Pick<CollabOutboxEntry, "roomKey" | "clientId" | "operationId">,
): string {
  return `${entry.roomKey}\u0000${entry.clientId}\u0000${entry.operationId}`;
}

function clone(entry: CollabOutboxEntry): CollabOutboxEntry {
  return { ...entry };
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB 请求失败"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB 事务失败"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB 事务已中止"));
  });
}

function createIndexedDbOutbox(
  factory: IDBFactory,
  namespace: string,
): CollabOutbox {
  let database: Promise<IDBDatabase> | undefined;
  const open = async () =>
    (database ??= new Promise((resolve, reject) => {
      const request = factory.open(`${DATABASE_NAME}:${namespace}`, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME))
          request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("IndexedDB 打开失败"));
    }));
  return {
    async put(entry) {
      const db = await open();
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({ ...clone(entry), key: keyOf(entry) });
      await transactionDone(tx);
    },
    async list(roomKey, clientId) {
      const db = await open();
      const tx = db.transaction(STORE_NAME, "readonly");
      const completed = transactionDone(tx);
      const rows = await requestValue<
        Array<CollabOutboxEntry & { key: string }>
      >(tx.objectStore(STORE_NAME).getAll());
      await completed;
      return rows
        .filter((row) => row.roomKey === roomKey && row.clientId === clientId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(({ key: _key, ...row }) => clone(row));
    },
    async remove(operationId) {
      const db = await open();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const completed = transactionDone(tx);
      const store = tx.objectStore(STORE_NAME);
      const rows = await requestValue<
        Array<CollabOutboxEntry & { key: string }>
      >(store.getAll());
      for (const row of rows)
        if (row.operationId === operationId) store.delete(row.key);
      await completed;
    },
  };
}

function createLocalStorageOutbox(
  storage: Storage,
  namespace: string,
): CollabOutbox {
  const read = (): CollabOutboxEntry[] => {
    try {
      const raw = storage.getItem(namespace);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((item): item is CollabOutboxEntry => {
            const value = item as Partial<CollabOutboxEntry>;
            return (
              typeof value.roomKey === "string" &&
              typeof value.clientId === "string" &&
              typeof value.operationId === "string" &&
              typeof value.updateBase64 === "string" &&
              typeof value.createdAt === "number"
            );
          })
        : [];
    } catch {
      return [];
    }
  };
  const write = (rows: CollabOutboxEntry[]) => {
    try {
      storage.setItem(namespace, JSON.stringify(rows));
    } catch {
      /* 降级存储不可用时由内存兜底 */
    }
  };
  let memory = read();
  return {
    async put(entry) {
      memory = [
        ...memory.filter((item) => item.operationId !== entry.operationId),
        clone(entry),
      ];
      write(memory);
    },
    async list(roomKey, clientId) {
      return memory
        .filter(
          (entry) => entry.roomKey === roomKey && entry.clientId === clientId,
        )
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(clone);
    },
    async remove(operationId) {
      memory = memory.filter((entry) => entry.operationId !== operationId);
      write(memory);
    },
  };
}

export function createCollabOutbox(options: OutboxOptions = {}): CollabOutbox {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const factory = options.indexedDB ?? globalThis.indexedDB;
  let storage = options.localStorage;
  if (storage === undefined) {
    try {
      storage = globalThis.localStorage;
    } catch {
      storage = undefined;
    }
  }
  const fallback = storage
    ? createLocalStorageOutbox(storage, namespace)
    : null;
  if (factory) {
    const primary = createIndexedDbOutbox(factory, namespace);
    let failed = false;
    const withFallback = async <T>(
      operation: (outbox: CollabOutbox) => Promise<T>,
      memoryFallback: () => Promise<T>,
    ): Promise<T> => {
      if (failed && fallback) return operation(fallback);
      try {
        return await operation(primary);
      } catch {
        failed = true;
        return fallback ? operation(fallback) : memoryFallback();
      }
    };
    const memory = createMemoryOutbox();
    return {
      put(entry) {
        return withFallback(
          (outbox) => outbox.put(entry),
          () => memory.put(entry),
        );
      },
      list(roomKey, clientId) {
        return withFallback(
          async (outbox) => {
            const persisted = await outbox.list(roomKey, clientId);
            if (!fallback) return persisted;
            const legacy = await fallback.list(roomKey, clientId);
            const known = new Set(persisted.map((entry) => entry.operationId));
            for (const entry of legacy)
              if (!known.has(entry.operationId)) await outbox.put(entry);
            for (const entry of legacy)
              await fallback.remove(entry.operationId);
            return [
              ...persisted,
              ...legacy.filter((entry) => !known.has(entry.operationId)),
            ].sort((a, b) => a.createdAt - b.createdAt);
          },
          () => memory.list(roomKey, clientId),
        );
      },
      remove(operationId) {
        return withFallback(
          (outbox) => outbox.remove(operationId),
          () => memory.remove(operationId),
        );
      },
    };
  }
  if (fallback) return fallback;
  return createMemoryOutbox();
}

function createMemoryOutbox(): CollabOutbox {
  const memory = new Map<string, CollabOutboxEntry>();
  return {
    async put(entry) {
      memory.set(entry.operationId, clone(entry));
    },
    async list(roomKey, clientId) {
      return [...memory.values()]
        .filter(
          (entry) => entry.roomKey === roomKey && entry.clientId === clientId,
        )
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(clone);
    },
    async remove(operationId) {
      memory.delete(operationId);
    },
  };
}

export type { CollabOutbox };
