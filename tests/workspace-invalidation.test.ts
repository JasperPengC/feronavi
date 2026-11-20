import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateFor } from "../src/client/lib/useEvents.ts";

const seed = (keys: unknown[][]) => { const qc = new QueryClient(); keys.forEach(key => qc.setQueryData(key, {})); return qc; };
const invalid = (qc: QueryClient, key: unknown[]) => qc.getQueryState(key)?.isInvalidated;
describe("个人和组织定向缓存失效", () => {
  it("会话事件只刷新当前账号的列表和该会话详情", () => {
    const qc = seed([["actor"], ["rag-conversations", "u1"], ["rag-conversations", "u2"], ["rag-conversation", "u1", "c1"], ["rag-conversation", "u1", "c2"], ["rag-conversation", "u2", "c1"]]);
    qc.setQueryData(["actor"], { memberId: "u1" });
    invalidateFor(qc, "workspace.invalidated", { domain: "ragConversation", projectId: null, resourceType: "RAG_CONVERSATION", resourceId: "c1" });
    expect(invalid(qc, ["rag-conversations", "u1"])).toBe(true);
    expect(invalid(qc, ["rag-conversation", "u1", "c1"])).toBe(true);
    for (const key of [["rag-conversations", "u2"], ["rag-conversation", "u1", "c2"], ["rag-conversation", "u2", "c1"]]) expect(invalid(qc, key)).toBe(false);
  });
  it("个人待办只刷新本人工作台/待办，不扫项目数据", () => {
    const qc = seed([["todos"], ["workbench"], ["board", "p1"], ["notifications"]]);
    invalidateFor(qc, "workspace.invalidated", { domain: "todo", projectId: null, resourceType: "TODO", resourceId: "t1" });
    expect(invalid(qc, ["todos"])).toBe(true); expect(invalid(qc, ["workbench"])).toBe(true);
    expect(invalid(qc, ["board", "p1"])).toBe(false); expect(invalid(qc, ["notifications"])).toBe(false);
  });
  it("共享保存视图只刷新对应项目与本人列表", () => {
    const qc = seed([["saved-views", "personal"], ["saved-views", "shared", "p1"], ["saved-views", "shared", "p2"]]);
    invalidateFor(qc, "workspace.invalidated", { domain: "savedView", projectId: "p1", resourceType: "SAVED_VIEW", resourceId: "v1" });
    expect(invalid(qc, ["saved-views", "personal"])).toBe(true); expect(invalid(qc, ["saved-views", "shared", "p1"])).toBe(true);
    expect(invalid(qc, ["saved-views", "shared", "p2"])).toBe(false);
  });
  it("项目集变更刷新列表与当前详情汇总", () => {
    const qc = seed([["portfolios"], ["portfolio", "f1"], ["portfolio-summary", "f1"], ["portfolio", "f2"]]);
    invalidateFor(qc, "workspace.invalidated", { domain: "portfolio", projectId: null, resourceType: "PORTFOLIO", resourceId: "f1" });
    for (const key of [["portfolios"], ["portfolio", "f1"], ["portfolio-summary", "f1"]]) expect(invalid(qc, key)).toBe(true);
    expect(invalid(qc, ["portfolio", "f2"])).toBe(false);
  });
  it("仪表盘和组织权限变化覆盖真实查询键", () => {
    const qc = seed([["dashboard", "d1"], ["dashboard", "d2"], ["dashboards", "p1"], ["dashboards", "p2"], ["widget-data", "w1"], ["rbac", "roles"], ["actor"], ["member-permissions", "u1"], ["teams"]]);
    qc.setQueryData(["actor"], { memberId: "u1" });
    invalidateFor(qc, "workspace.invalidated", { domain: "dashboard", projectId: "p1", resourceType: "DASHBOARD", resourceId: "d1" });
    for (const key of [["dashboard", "d1"], ["dashboards", "p1"], ["widget-data", "w1"]]) expect(invalid(qc, key)).toBe(true);
    expect(invalid(qc, ["dashboard", "d2"])).toBe(false); expect(invalid(qc, ["dashboards", "p2"])).toBe(false);
    invalidateFor(qc, "workspace.invalidated", { domain: "role", projectId: null, resourceType: "ROLE", resourceId: "r1" });
    expect(invalid(qc, ["rbac", "roles"])).toBe(true);
    invalidateFor(qc, "workspace.invalidated", { domain: "directory", projectId: null, resourceType: "MEMBER", resourceId: "u1" });
    for (const key of [["actor"], ["member-permissions", "u1"], ["teams"]]) expect(invalid(qc, key)).toBe(true);
  });
  it("未知/不完整成员事件不能全量清缓存", () => {
    const qc = seed([["todos"], ["workbench"]]);
    invalidateFor(qc, "workspace.invalidated", { domain: "todo", resourceId: "t1" });
    invalidateFor(qc, "workspace.invalidated", { domain: "unknown", projectId: null, resourceType: "TODO", resourceId: "t1" });
    expect(invalid(qc, ["todos"])).toBe(false); expect(invalid(qc, ["workbench"])).toBe(false);
  });
  it("模板事件刷新模板选择，工作项和计划变更刷新跨项目统计", () => {
    const qc = seed([["project-templates"], ["portfolio-summary", "f1"], ["widget-data", "w1"], ["todos"]]);
    invalidateFor(qc, "workspace.invalidated", { domain: "projectTemplate", projectId: null, resourceType: "PROJECT_TEMPLATE", resourceId: "t1" });
    expect(invalid(qc, ["project-templates"])).toBe(true);
    invalidateFor(qc, "resource.invalidated", { domain: "workitem", projectId: "p1", resourceType: "WORK_ITEM", resourceId: "w1" });
    expect(invalid(qc, ["portfolio-summary", "f1"])).toBe(true); expect(invalid(qc, ["widget-data", "w1"])).toBe(true);
    expect(invalid(qc, ["todos"])).toBe(false);
  });
  it("其他成员目录变更不触发当前登录身份重载", () => {
    const qc = seed([["actor"], ["members"], ["member-permissions", "u2"]]);
    qc.setQueryData(["actor"], { memberId: "u1" });
    invalidateFor(qc, "workspace.invalidated", { domain: "directory", projectId: null, resourceType: "MEMBER", resourceId: "u2" });
    expect(invalid(qc, ["actor"])).toBe(false);
    expect(invalid(qc, ["members"])).toBe(true); expect(invalid(qc, ["member-permissions", "u2"])).toBe(true);
  });
});
