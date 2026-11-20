// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  visible: true,
  workflowId: "workflow",
  status: vi.fn(),
}));
vi.mock("../src/db/index.ts", () => ({ db: {}, sql: {} }));
vi.mock("../src/server/repos/work-item.repo.ts", () => ({
  findById: async () => ({
    id: "item",
    projectId: "project",
    workflowId: "workflow",
    statusId: "state",
    version: 2,
    title: "current",
  }),
}));
vi.mock("../src/server/repos/project.repo.ts", () => ({
  findById: async () => ({ id: "project" }),
  isVisibleTo: async () => state.visible,
}));
vi.mock("../src/server/repos/workflow.repo.ts", () => ({
  findStateById: state.status,
}));
vi.mock("../src/server/services/collab.service.ts", () => ({
  isCollaborator: async () => false,
}));
import { getWorkItem } from "../src/server/services/work-item.service.ts";
beforeEach(() => {
  state.visible = true;
  state.status.mockReset();
  state.status.mockResolvedValue({
    id: "state",
    workflowId: "workflow",
    key: "TODO",
    name: "待办",
    category: "INITIAL",
  });
});
it("普通工作项读取直接提供当前状态业务字段，保留标题版本", async () => {
  expect(
    await getWorkItem({ memberId: "member", grants: [] } as never, "item"),
  ).toMatchObject({
    title: "current",
    version: 2,
    statusKey: "TODO",
    statusName: "待办",
    statusCategory: "INITIAL",
  });
  expect(state.status).toHaveBeenCalledWith("state");
});
it.each([
  null,
  {
    id: "state",
    workflowId: "other",
    key: "DONE",
    name: "错误工作流",
    category: "TERMINAL",
  },
])("状态缺失或工作流不匹配不能冒用名称", async (status) => {
  state.status.mockResolvedValue(status);
  expect(
    await getWorkItem({ memberId: "member", grants: [] } as never, "item"),
  ).toMatchObject({ statusKey: null, statusName: null, statusCategory: null });
});
it("无工作项可见权限时不读取或泄露状态", async () => {
  state.visible = false;
  await expect(
    getWorkItem({ memberId: "member", grants: [] } as never, "item"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(state.status).not.toHaveBeenCalled();
});
