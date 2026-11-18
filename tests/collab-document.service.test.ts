import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  applyDocumentUpdate,
  encodeDocumentState,
  decodeDocumentState,
  createContentUpdate,
} from "../src/server/services/collab-document-core.ts";
import { assertIndexRevision, assertPublishRevision } from "../src/server/services/collab-document-core.ts";
import { DomainError } from "../src/shared/errors.ts";

function updateFor(text: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, text);
  return Y.encodeStateAsUpdate(doc);
}

describe("协作文档 update 合并", () => {
  it("合并多个客户端 update，并可从 snapshot 恢复", () => {
    const first = updateFor("hello ");
    const secondDoc = new Y.Doc();
    Y.applyUpdate(secondDoc, first);
    secondDoc.getText("content").insert(6, "world");
    const second = Y.encodeStateAsUpdate(secondDoc, Y.encodeStateVector(new Y.Doc()));

    const merged = applyDocumentUpdate(first, second);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, merged);
    expect(restored.getText("content").toString()).toBe("hello world");
    expect(decodeDocumentState(encodeDocumentState(restored)).getText("content").toString()).toBe("hello world");
  });

  it("拒绝空 update，且同一 operationId 由调用方保持幂等", () => {
    expect(() => applyDocumentUpdate(new Uint8Array(), new Uint8Array())).toThrow(/不能为空/);
  });

  it("将 Agent 正文写入编码为相对当前 Yjs 状态的增量", () => {
    const initial = updateFor("before");
    const delta = createContentUpdate(initial, "after");
    expect(delta).not.toBeNull();
    const merged = applyDocumentUpdate(initial, delta!);
    expect(decodeDocumentState(merged).getText("content").toString()).toBe("after");
    expect(createContentUpdate(merged, "after")).toBeNull();
  });

  it("只允许以协作房间记录的基线 revision 发布", () => {
    expect(assertPublishRevision("revision-1", "revision-1")).toBeUndefined();
    try {
      assertPublishRevision("revision-2", "revision-1");
      throw new Error("expected VERSION_CONFLICT");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("VERSION_CONFLICT");
      expect((error as DomainError).httpStatus).toBe(409);
    }
  });

  it("索引发布时必须锁定刚提交的 revision", () => {
    expect(() => assertIndexRevision("revision-2", "revision-2")).not.toThrow();
    expect(() => assertIndexRevision("revision-3", "revision-2")).toThrow(/版本|revision/i);
  });
});
