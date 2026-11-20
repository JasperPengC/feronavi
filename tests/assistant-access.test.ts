// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import type { RagChatResult } from "../src/shared/rag.ts";
const state = vi.hoisted(() => ({ denied: false, policy: vi.fn(), viewProject: null as string | null, viewRead: vi.fn() }));
vi.mock("../src/server/services/assistant-capabilities.ts", () => ({
  assistantCapabilities: () => [{ name: "savedView.get", kind: "read", scope: "project-set", handler: state.viewRead }],
}));
vi.mock("../src/db/index.ts", () => ({
  db: {
    select: () => ({
      from: () => ({ where: async () => [{ id: "w", projectId: "p" }] }),
    }),
  },
}));
vi.mock("../src/server/services/mcp-client.service.ts", () => ({
  assertToolPolicyAllowed: state.policy,
}));
vi.mock("../src/server/services/work-item.service.ts", () => ({
  getWorkItem: async () => ({ projectId: "p" }),
}));
vi.mock("../src/server/services/mcp-resource.service.ts", () => ({
  projectForMcpResource: async () => state.viewProject,
}));
vi.mock("../src/server/services/wiki.service.ts", () => ({ getPage: vi.fn() }));
import { assertAssistantReplyReadable } from "../src/server/services/assistant-access.ts";
beforeEach(() => {
  state.denied = false;
  state.viewProject = null;
  state.viewRead.mockReset();
  state.policy.mockReset();
  state.policy.mockImplementation(async (_token, tool) => {
    if (state.denied && tool === "workitem.update")
      throw Object.assign(new Error("DENY"), { code: "FORBIDDEN" });
  });
});
it("个人视图无项目或已有项目时回读保留全账号令牌，且仍拒绝受限令牌和越界共享视图", async () => {
  const reply = {
    scope: { projectIds: [], projectCount: 0 },
    actions: [{ toolName: "savedView.create", status: "confirmed", scope: { kind: "project-set", projectIds: [] },
      result: { verificationReads: [{ toolName: "savedView.get", parameters: { savedViewId: "v" } }] } }],
  } as unknown as RagChatResult;
  for (const projects of [[], ["p"]]) {
    await expect(assertAssistantReplyReadable({ memberId: "m" } as never, reply, projects)).resolves.toBeUndefined();
    expect(state.viewRead.mock.lastCall?.[0].token.projectWhitelist).toEqual([]);
  }
  await expect(assertAssistantReplyReadable({ memberId: "m" } as never, reply, ["p"], { tokenId: "t", projectWhitelist: ["p"] } as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
  state.viewProject = "outside";
  await expect(assertAssistantReplyReadable({ memberId: "m" } as never, reply, ["p"])).rejects.toMatchObject({ code: "FORBIDDEN" });
  state.viewProject = "p";
  await expect(assertAssistantReplyReadable({ memberId: "m" } as never, reply, ["p"])).resolves.toBeUndefined();
  expect(state.viewRead.mock.lastCall?.[0].token.projectWhitelist).toEqual(["p"]);
});
it.each([false, true])(
  "建议当前领域DENY即拒绝，不由允许的读取证据替代（混合=%s）",
  async (mixed) => {
    const reply = {
      scope: { projectIds: ["p"], projectCount: 1 },
      actions: [
        { id: "a", toolName: "workitem.update", projectId: "p", targetId: "w" },
      ],
      evidence: mixed
        ? [{ toolName: "workitem.get", projectId: "p", resources: [] }]
        : [],
    } as unknown as RagChatResult;
    const token = { tokenId: "t" } as never;
    await expect(
      assertAssistantReplyReadable({} as never, reply, ["p"], token),
    ).resolves.toBeUndefined();
    expect(state.policy).toHaveBeenCalledWith("t", "workitem.update");
    state.denied = true;
    await expect(
      assertAssistantReplyReadable({} as never, reply, ["p"], token),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  },
);
it("project.context交付时重新校验所有嵌套读取策略", async () => {
  state.policy.mockImplementation(async (_token, tool) => {
    if (tool === "workitem.list")
      throw Object.assign(new Error("DENY nested"), { code: "FORBIDDEN" });
  });
  const reply = {
    scope: { projectIds: ["p"], projectCount: 1 },
    evidence: [
      {
        id: "e",
        toolName: "project.context",
        projectId: "p",
        observedAt: "now",
        resources: [],
        summary: "context",
      },
    ],
  } as unknown as RagChatResult;
  await expect(
    assertAssistantReplyReadable(
      {} as Parameters<typeof assertAssistantReplyReadable>[0],
      reply,
      ["p"],
      { tokenId: "token" } as Parameters<
        typeof assertAssistantReplyReadable
      >[3],
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("project.context最初被拒绝的子区段保持降级，不阻断允许区段交付", async () => {
  state.policy.mockImplementation(async (_token, tool) => {
    if (tool === "customField.definitions")
      throw Object.assign(new Error("DENY field"), { code: "FORBIDDEN" });
  });
  const reply = {
    scope: { projectIds: ["p"], projectCount: 1 },
    evidence: [
      {
        id: "e",
        toolName: "project.context",
        projectId: "p",
        observedAt: "now",
        resources: [],
        summary: "context",
        readTools: ["project.get", "workitem.list"],
      },
    ],
  } as unknown as RagChatResult;
  await expect(
    assertAssistantReplyReadable(
      {} as Parameters<typeof assertAssistantReplyReadable>[0],
      reply,
      ["p"],
      { tokenId: "token" } as Parameters<
        typeof assertAssistantReplyReadable
      >[3],
    ),
  ).resolves.toBeUndefined();
});
