import * as Y from "yjs";
import { MAX_UPDATE_BYTES } from "./collab-room.service.ts";
import { DomainError } from "../../shared/errors.ts";

export type DocumentBinary = Uint8Array<ArrayBufferLike>;

export function assertPublishRevision(currentRevisionId: string | null, expectedRevisionId: string): void {
  if (!currentRevisionId || currentRevisionId !== expectedRevisionId) {
    throw new DomainError("VERSION_CONFLICT", "基线版本已变化，请刷新协作草稿后再发布", {
      expected: expectedRevisionId,
      actual: currentRevisionId,
    });
  }
}

export function assertIndexRevision(currentRevisionId: string | null, expectedRevisionId: string): void {
  if (currentRevisionId !== expectedRevisionId) throw new DomainError("VERSION_CONFLICT", "页面版本已变化，索引目标已过期", {
    expected: expectedRevisionId,
    actual: currentRevisionId,
  });
}

export function encodeDocumentState(doc: Y.Doc): DocumentBinary {
  return Y.encodeStateAsUpdate(doc);
}

export function decodeDocumentState(state: DocumentBinary): Y.Doc {
  if (state.byteLength === 0) throw new Error("文档状态不能为空");
  const doc = new Y.Doc();
  try { Y.applyUpdate(doc, state); } catch { throw new Error("文档状态不是合法的 Yjs update"); }
  return doc;
}

export function applyDocumentUpdate(currentState: DocumentBinary, update: DocumentBinary): DocumentBinary {
  if (currentState.byteLength === 0 && update.byteLength === 0) throw new Error("update 不能为空");
  if (update.byteLength > MAX_UPDATE_BYTES) throw new Error("update 超过 1MB 限制");
  const doc = new Y.Doc();
  try {
    if (currentState.byteLength > 0) Y.applyUpdate(doc, currentState);
    Y.applyUpdate(doc, update);
  } catch { throw new Error("update 不是合法的 Yjs 二进制数据"); }
  return encodeDocumentState(doc);
}

export function createContentUpdate(currentState: DocumentBinary, content: string): DocumentBinary | null {
  const doc = currentState.byteLength ? decodeDocumentState(currentState) : new Y.Doc();
  const text = doc.getText("content");
  if (text.toString() === content) return null;
  const vector = Y.encodeStateVector(doc);
  text.delete(0, text.length);
  if (content) text.insert(0, content);
  return Y.encodeStateAsUpdate(doc, vector);
}
