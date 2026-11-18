// @vitest-environment node
import { expect, it, vi } from "vitest";
import type { Actor } from "../src/server/permission/actor.ts";
vi.mock("../src/db/index.ts", () => ({ db: {}, sql: {} }));
vi.mock("../src/server/repos/work-item.repo.ts", () => ({ findById: async () => ({ id: "item", projectId: "project", reporterId: "m", type: "TASK" }), updateWithVersion: async () => null }));
vi.mock("../src/server/repos/project.repo.ts", () => ({ findById: async () => ({ id: "project" }), isVisibleTo: async () => true }));
vi.mock("../src/server/services/collab.service.ts", () => ({ isCollaborator: async () => false }));
import { updateWorkItem, createWorkItem } from "../src/server/services/work-item.service.ts";
const actor: Actor = { memberId: "m", username: "m", name: "m", permissions: new Set(["work_item:update_any", "work_item:create"]), grants: [{ roleKey: "ADMIN", scopeType: "ORG", scopeId: null }], mustChangePassword: false, locale: "zh-CN", timezone: null, theme: null };
for (const patch of [{ version: 1, statusId: "state" }, { version: 1, projectId: "other" }, { version: 1, reporterId: "other" }, { version: "1", title: "x" }, { title: "missing-version" }]) {
  it(`服务层拒绝非法更新字段 ${JSON.stringify(patch)}`, async () => {
    await expect(updateWorkItem(actor, "item", patch)).rejects.toMatchObject({ code: "VALIDATION" });
  });
}
it("服务层创建时也执行共享类型和未知字段约束", async () => {
  await expect(createWorkItem(actor, "project", { type: "TASK", title: "x", statusId: "state" } as never)).rejects.toMatchObject({ code: "VALIDATION" });
});
