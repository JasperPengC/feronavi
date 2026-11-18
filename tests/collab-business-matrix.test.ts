import { describe, expect, it } from "vitest";
import { COLLAB_MODES, COLLAB_RESOURCE_TYPES, modeForResource } from "../src/server/services/collab-room.service.ts";

describe("全站协作能力矩阵", () => {
  it("文本页面与结构化业务命令分流", () => {
    expect(COLLAB_RESOURCE_TYPES).toEqual(["PAGE", "WORK_ITEM", "COMMENT", "PLAN", "APPROVAL", "AUTOMATION"]);
    expect(COLLAB_MODES).toEqual(["TEXT_CRDT", "COMMAND"]);
    expect(modeForResource("PAGE")).toBe("TEXT_CRDT");
    for (const resource of ["WORK_ITEM", "COMMENT", "PLAN", "APPROVAL", "AUTOMATION"] as const) {
      expect(modeForResource(resource)).toBe("COMMAND");
    }
  });
});
