// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  turn: vi.fn(),
  propose: vi.fn(),
  extra: [] as {
    name: string;
    kind: string;
    description: string;
    inputSchema: object;
  }[],
  usage: vi.fn(),
  mode: "vector",
  project: "11111111-1111-4111-8111-111111111111",
  page: "22222222-2222-4222-8222-222222222222",
}));
vi.mock("../src/server/auth/actor-loader.ts", () => ({
  loadActor: async () => ({ memberId: "actor", grants: [] }),
}));
vi.mock("../src/server/repos/project.repo.ts", () => ({
  listVisible: async () => ({
    rows: [{ id: state.project, key: "P", name: "Project" }],
    total: 1,
  }),
}));
vi.mock("../src/server/services/knowledge.service.ts", () => ({
  loadChatConfig: async () => ({
    baseUrl: "https://model.example",
    apiKey: "",
    model: "m",
  }),
  searchKnowledgeInProjects: vi.fn(),
}));
vi.mock("../src/server/services/assistant-access.ts", () => ({
  refreshAssistantToken: vi.fn(),
  assertAssistantReplyReadable: async () => {},
}));
vi.mock("../src/server/services/wiki.service.ts", () => ({
  getPage: async () => ({ projectId: state.project }),
}));
vi.mock("../src/server/services/assistant-provider.ts", () => ({
  providerTurn: state.turn,
}));
vi.mock("../src/server/services/ai-config.service.ts", () => ({
  addUsage: state.usage,
}));
vi.mock("../src/server/services/assistant-tools.ts", () => ({
  proposeAssistantAction: state.propose,
  ASSISTANT_BASE_TOOLS: new Set(["knowledge.search","workitem.update","workitem.deleteTimeLog"]),
  assistantRegistry: async () => [
    ...state.extra,
    {
      name: "knowledge.search",
      kind: "read",
      description: "search",
      inputSchema: {},
    },
  ],
  executeAssistantTool: async () => ({
    value: {
      mode: state.mode,
      hits: [
        {
          pageId: state.page,
          title: "source",
          headingPath: null,
          snippet: "fact",
          chunkId: state.page,
          score: 1,
          mode: state.mode,
        },
      ],
    },
    projectId: state.project,
    resources: [],
  }),
}));
import { chatRag } from "../src/server/services/rag.service.ts";
beforeEach(() => {
  state.extra = [];
  state.propose.mockReset();
  state.turn.mockReset();
  state.usage.mockReset();
  state.turn
    .mockResolvedValueOnce({
      content: "",
      calls: [
        {
          id: "1",
          name: "knowledge_search",
          arguments: JSON.stringify({ projectId: state.project, q: "q" }),
        },
      ],
      usage: 10,
    })
    .mockResolvedValueOnce({ content: "", calls: [], usage: 20 })
    .mockResolvedValueOnce({ content: "answer", calls: [], usage: 30 });
});
it.each(["vector", "keyword"])(
  "保留真实%s检索mode并为成功turn逐次计量",
  async (mode) => {
    state.mode = mode;
    const reply = await chatRag({ memberId: "actor", grants: [] } as never, {
      question: "q",
    });
    expect(reply.mode).toBe(mode);
    expect(reply.citations[0]?.projectId).toBe(state.project);
    expect(state.usage).toHaveBeenCalledTimes(3);
    expect(state.usage.mock.calls.map((c) => c[1])).toEqual([
      { tokens: 10, calls: 1 },
      { tokens: 20, calls: 1 },
      { tokens: 30, calls: 1 },
    ]);
  },
);
it("真实知识命中精确投影Citation字段，不能带chunk/score/mode破坏MCP输出schema", async () => {
  state.mode = "keyword";
  const reply = await chatRag({ memberId: "actor", grants: [] } as never, {
    question: "q",
  });
  expect(Object.keys(reply.citations[0]!).sort()).toEqual(
    [
      "pageId",
      "projectId",
      "projectName",
      "title",
      "headingPath",
      "snippet",
    ].sort(),
  );
  const { AjvJsonSchemaValidator } =
    await import("@modelcontextprotocol/sdk/validation/ajv");
  const { outputSchemaFor } = await import("../src/server/mcp/contracts.ts");
  expect(
    new AjvJsonSchemaValidator().getValidator(
      outputSchemaFor({ name: "rag.chat" } as never),
    )({ result: reply }).valid,
  ).toBe(true);
});

it("内部propose调用登记真实操作卡并以原域名报告status，最终状态仅认可真实action", async () => {
  state.extra = [
    {
      name: "workitem.update",
      kind: "write",
      description: "update",
      inputSchema: {},
    },
  ];
  const proposal = { id: "a", toolName: "workitem.update", status: "pending" };
  state.propose.mockResolvedValue(proposal);
  state.turn.mockReset();
  const executionStates: {
    confirmation: { available: boolean; actionIds: string[] };
  }[] = [];
  state.turn.mockImplementation(async (_config, messages, tools) => {
    const stateMessage = messages.find(
      (m: { role: string; content?: string }) =>
        m.role === "system" &&
        m.content?.startsWith('{"type":"assistant_execution_state"'),
    );
    executionStates.push(JSON.parse(stateMessage.content));
    if (executionStates.length === 1) {
      expect(
        tools.some(
          (t: { function: { name: string } }) =>
            t.function.name === "propose_workitem_update",
        ),
      ).toBe(true);
      return {
        content: "",
        calls: [
          {
            id: "w",
            name: "propose_workitem_update",
            arguments: JSON.stringify({ workItemId: "w", title: "updated" }),
          },
        ],
        usage: 1,
      };
    }
    return { content: "建议已登记", calls: [], usage: 1 };
  });
  const emit = vi.fn(async () => {});
  const reply = await chatRag(
    { memberId: "actor", grants: [] } as never,
    { question: "先生成修改建议，确认再执行" },
    undefined,
    undefined,
    { persistent: true, emit },
  );
  expect(state.propose).toHaveBeenCalledTimes(1);
  expect(state.propose.mock.calls[0]?.[1].name).toBe("workitem.update");
  expect(reply.actions).toEqual([proposal]);
  expect(executionStates[0]?.confirmation.available).toBe(false);
  expect(executionStates.at(-1)?.confirmation).toEqual({
    available: true,
    actionIds: ["a"],
  });
  expect(emit).toHaveBeenCalledWith({
    type: "status",
    phase: "tool",
    toolName: "workitem.update",
  });
});
it("最终轮保留未核验计划和无操作卡的服务端事实", async () => {
  state.turn.mockReset();
  state.turn.mockImplementation(async (_config, messages) => {
    const stateMessage = messages.find(
      (m: { role: string; content?: string }) =>
        m.role === "system" &&
        m.content?.startsWith('{"type":"assistant_execution_state"'),
    );
    const execution = JSON.parse(stateMessage.content);
    expect(execution.confirmation).toEqual({ available: false, actionIds: [] });
    expect(execution.plans[0].milestones.state).toBe("unverified");
    expect(execution.plans[0].canClaimNoSupportedPlans).toBe(false);
    return { content: "尚未核验", calls: [], usage: 1 };
  });
  const reply = await chatRag({ memberId: "actor", grants: [] } as never, {
    question: "是否有计划基准",
  });
  expect(reply.actions).toEqual([]);
  expect(state.turn).toHaveBeenCalledTimes(2);
});

it("模型规划提示允许已开放的子记录删除，同时保留主体和外部发送边界", async () => {
  await chatRag({memberId:"actor",grants:[]} as never,{question:"记录并复核工时"});
  const messages=state.turn.mock.calls[0]![1] as {role:string;content:string}[];
  const system=messages.find(row=>row.role === "system")!.content;
  expect(system).toContain("工时/进展子记录删除");
  expect(system).toContain("工作项/文档主体删除");
  expect(system).toContain("发送邮件/IM");
  expect(system).toContain("外部同步通过后台队列");
});

it("模型只声称生成卡但没有调用工具时，允许一次纠正并返回真实登记建议", async () => {
  state.extra = [{ name: "workitem.update", kind: "write", description: "update", inputSchema: {} }];
  const proposal = { id: "a", toolName: "workitem.update", status: "pending" };
  state.propose.mockResolvedValue(proposal);
  state.turn.mockReset();
  let turns = 0;
  state.turn.mockImplementation(async (_config, _messages, tools) => {
    turns++;
    if (turns === 1) return { content: "已为你生成一条待确认建议，请点击确认。", calls: [], usage: 1 };
    if (turns === 2 && tools.length) return { content: "", calls: [{ id: "w", name: "propose_workitem_update", arguments: '{"workItemId":"w","title":"updated"}' }], usage: 1 };
    return { content: "建议已登记，请核对后确认。", calls: [], usage: 1 };
  });
  const reply = await chatRag({ memberId: "actor", grants: [] } as never, { question: "生成修改建议，确认后再执行" }, undefined, undefined, { persistent: true });
  expect(reply.actions).toEqual([proposal]);
  expect(reply.answer).toContain("建议已登记");
});

it("纠正后仍虚构确认卡时，重置流并如实说明没有建议，重试次数有界", async () => {
  state.extra = [{ name: "workitem.update", kind: "write", description: "update", inputSchema: {} }];
  state.turn.mockReset().mockResolvedValue({ content: "已为你生成一条待确认建议，请点击确认。", calls: [], usage: 1 });
  const emit = vi.fn(async () => {});
  const reply = await chatRag({ memberId: "actor", grants: [] } as never, { question: "生成修改建议" }, undefined, undefined, { persistent: true, emit });
  expect(reply.actions).toEqual([]);
  expect(reply.answer).toContain("未生成可确认的操作建议");
  expect(reply.answer).not.toContain("请点击确认");
  expect(emit).toHaveBeenCalledWith({ type: "reset" });
  expect(state.turn).toHaveBeenCalledTimes(3);
});

it.each(["确认卡已创建，请核对后确认。", "待确认建议已创建，确认后即可生效。", "未执行变更。确认卡已创建。"])("无卡时拦截目标在前的虚构说法：%s", async content => {
  state.turn.mockReset().mockResolvedValue({ content, calls: [], usage: 1 });
  const reply = await chatRag({ memberId: "actor", grants: [] } as never, { question: "本轮有待确认操作吗" }, undefined, undefined, { persistent: true });
  expect(reply.actions).toEqual([]);
  expect(reply.answer).toContain("未生成可确认的操作建议");
});

it.each(["这轮有没有确认卡？", "如何生成修改建议？", "不要生成修改建议，只说明现状。"])("否定和说明查询不会触发建议登记纠正：%s", async question => {
  const content = "当前没有已生成的确认卡，请不要点击确认。";
  state.extra = [{ name: "workitem.update", kind: "write", description: "update", inputSchema: {} }];
  state.turn.mockReset().mockResolvedValue({ content, calls: [], usage: 1 });
  const reply = await chatRag({ memberId: "actor", grants: [] } as never, { question }, undefined, undefined, { persistent: true });
  expect(reply.answer).toBe(content);
  expect(reply.actions).toEqual([]);
  expect(state.turn).toHaveBeenCalledTimes(2);
});

it.each(["请说明生成修改建议的流程。", "解释一下创建确认卡的方法。", "你能生成修改建议吗？"])("说明和能力询问即使模型虚构卡也不会额外要求登记：%s", async question => {
  state.extra = [{ name: "workitem.update", kind: "write", description: "update", inputSchema: {} }];
  state.turn.mockReset().mockResolvedValue({ content: "确认卡已创建，请核对后确认。", calls: [], usage: 1 });
  const reply = await chatRag({ memberId: "actor", grants: [] } as never, { question }, undefined, undefined, { persistent: true });
  expect(reply.actions).toEqual([]);
  expect(reply.answer).toContain("未生成可确认的操作建议");
  expect(state.turn).toHaveBeenCalledTimes(2);
});
