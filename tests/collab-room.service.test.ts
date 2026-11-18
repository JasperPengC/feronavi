import { describe, expect, it } from "vitest";
import {
  COLLAB_RESOURCE_TYPES,
  COLLAB_MODES,
  roomKey,
  modeForResource,
  assertDocumentUpdateAllowed,
  validateDocumentUpdate,
  validateClientId,
  assertRoomLogCapacity,
  shouldAutoSnapshot,
  operationKey,
} from "../src/server/services/collab-room.service.ts";

describe("协作房间契约", () => {
  it("使用稳定的资源房间键并为页面选择文本 CRDT", () => {
    expect(roomKey("PAGE", "11111111-1111-4111-8111-111111111111")).toBe("PAGE/11111111-1111-4111-8111-111111111111");
    expect(modeForResource("PAGE")).toBe("TEXT_CRDT");
    expect(modeForResource("WORK_ITEM")).toBe("COMMAND");
  });

  it("拒绝未知资源类型和空客户端标识", () => {
    expect(COLLAB_RESOURCE_TYPES).toContain("PAGE");
    expect(COLLAB_MODES).toEqual(["TEXT_CRDT", "COMMAND"]);
    expect(() => modeForResource("UNKNOWN" as never)).toThrow(/资源类型/);
    expect(() => validateClientId(" ")).toThrow(/客户端/);
    expect(validateClientId("web-1")).toBe("web-1");
  });

  it("只允许有页面写权限的调用方提交有限大小的页面 update", () => {
    const update = Buffer.from([1, 2, 3]).toString("base64");
    expect(assertDocumentUpdateAllowed("TEXT_CRDT", true)).toBeUndefined();
    expect(() => assertDocumentUpdateAllowed("TEXT_CRDT", false)).toThrow(/写权限/);
    expect(() => assertDocumentUpdateAllowed("COMMAND", true)).toThrow(/正文/);
    expect(validateDocumentUpdate({ operationId: "op-1", updateBase64: update })).toEqual({
      operationId: "op-1",
      update: new Uint8Array([1, 2, 3]),
    });
    expect(() => validateDocumentUpdate({ operationId: "", updateBase64: update })).toThrow(/操作标识/);
    expect(() => validateDocumentUpdate({ operationId: "op-1", updateBase64: "***" })).toThrow(/编码/);
    expect(() => validateDocumentUpdate({ operationId: "op-1", updateBase64: "" })).toThrow(/不能为空/);
  });

  it("幂等范围包含 actor，房间日志达到累计上限时拒绝", () => {
    expect(operationKey("actor-a", "web", "op-1")).not.toBe(operationKey("actor-b", "web", "op-1"));
    expect(() => assertRoomLogCapacity(10, 100, 50)).not.toThrow();
    expect(() => assertRoomLogCapacity(10_000, 100, 50)).toThrow(/条数/);
    expect(() => assertRoomLogCapacity(10, 50_000_000, 50)).toThrow(/大小/);
    expect(shouldAutoSnapshot(100, 1_000)).toBe(true);
  });
});
