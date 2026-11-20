import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateFor } from "../src/client/lib/useEvents.ts";

const seed = (keys: unknown[][]) => {
  const qc = new QueryClient();
  keys.forEach((key) => qc.setQueryData(key, {}));
  return qc;
};
const invalid = (qc: QueryClient, key: unknown[]) => qc.getQueryState(key)?.isInvalidated;
describe("普通页面资源失效", () => {
  it("附件只刷新目标资源，保留其他项目和附件缓存", () => {
    const qc = seed([["attachments", "WORK_ITEM", "w1"], ["attachments", "PAGE", "p1"], ["board", "p2"]]);
    invalidateFor(qc, "resource.invalidated", { domain: "attachment", projectId: "p1", resourceType: "WORK_ITEM", resourceId: "w1" });
    expect(invalid(qc, ["attachments", "WORK_ITEM", "w1"])).toBe(true);
    expect(invalid(qc, ["attachments", "PAGE", "p1"])).toBe(false);
    expect(invalid(qc, ["board", "p2"])).toBe(false);
  });
  it("计划更新涵盖当前与归档列表且只影响对应项目", () => {
    const qc = seed([["plan-entities", "iteration", "p1", false], ["plan-entities", "iteration", "p1", true], ["plan-entities", "iteration", "p2", false], ["iteration-capacity", "i1"]]);
    invalidateFor(qc, "resource.invalidated", { domain: "plan", projectId: "p1", resourceType: "ITERATION", resourceId: "i1" });
    expect(invalid(qc, ["plan-entities", "iteration", "p1", false])).toBe(true);
    expect(invalid(qc, ["plan-entities", "iteration", "p1", true])).toBe(true);
    expect(invalid(qc, ["iteration-capacity", "i1"])).toBe(true);
    expect(invalid(qc, ["plan-entities", "iteration", "p2", false])).toBe(false);
  });
  it("导入完成/回滚更新批次与所属项目看板，不扫其他项目", () => {
    const qc = seed([["imports", "p1"], ["import", "b1"], ["import", "b2"], ["board", "p1"], ["board", "p2"]]);
    invalidateFor(qc, "resource.invalidated", { domain: "import", projectId: "p1", resourceType: "IMPORT_BATCH", resourceId: "b1" });
    for (const key of [["imports", "p1"], ["import", "b1"], ["board", "p1"]]) expect(invalid(qc, key)).toBe(true);
    for (const key of [["import", "b2"], ["board", "p2"]]) expect(invalid(qc, key)).toBe(false);
  });
  it("未知或不完整的载荷不会全量清缓存，dropped仍回源", () => {
    const qc = seed([["board", "p1"], ["notifications"]]);
    invalidateFor(qc, "resource.invalidated", { domain: "account", title: "private" });
    expect(invalid(qc, ["board", "p1"])).toBe(false);
    invalidateFor(qc, "dropped", {});
    expect(invalid(qc, ["board", "p1"])).toBe(true);
  });
});
