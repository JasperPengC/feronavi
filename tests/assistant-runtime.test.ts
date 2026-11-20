// @vitest-environment node
import { expect, it, vi } from "vitest";
import { runAssistantLoop } from "../src/server/services/assistant-runtime.ts";
it("发现工具后下一轮读取更新后的工具集", async () => {
  let active = ["discover"];
  const supplied: unknown[][] = [];
  let turns = 0;
  await runAssistantLoop({ messages: [], tools: () => active,
    turn: async (_m, tools) => { supplied.push([...tools]); return ++turns === 1 ? {content:"",calls:[{id:"load",name:"load",arguments:"{}"}]} : {content:"完成",calls:[]}; },
    invoke: async () => { active = ["discover", "todo"]; return {}; }, check:async()=>{},status:async()=>{} });
  expect(supplied[0]).toEqual(["discover"]);
  expect(supplied[1]).toEqual(["discover","todo"]);
});
it("真正工具多轮调用，工具结果回传供应商，最后一轮才输出答案", async () => {
  const invoke = vi.fn().mockResolvedValue({ total: 3 });
  const turn = vi
    .fn()
    .mockResolvedValueOnce({
      content: "规划",
      calls: [
        { id: "1", name: "workitem_list", arguments: '{"projectId":"p"}' },
      ],
    })
    .mockResolvedValueOnce({ content: "", calls: [] })
    .mockResolvedValueOnce({ content: "三个", calls: [] });
  const messages: import("../src/server/services/assistant-provider.ts").ProviderMessage[] =
    [];
  const result = await runAssistantLoop({
    messages,
    tools: [{}],
    turn,
    invoke,
    check: async () => {},
    status: async () => {},
  });
  expect(invoke).toHaveBeenCalledWith("workitem_list", { projectId: "p" });
  expect(
    messages.some((m) => m.role === "tool" && m.content?.includes("3")),
  ).toBe(true);
  expect(result).toBe("三个");
  expect(turn.mock.calls.at(-1)?.[1]).toEqual([]);
});
it("总调用和轮数有界；畸形参数、空权限不执行工具", async () => {
  const invoke = vi.fn();
  const turn = vi.fn().mockResolvedValue({
    content: "",
    calls: Array.from({ length: 33 }, (_, i) => ({
      id: String(i),
      name: "x",
      arguments: "{}",
    })),
  });
  await expect(
    runAssistantLoop({
      messages: [],
      tools: [{}],
      turn,
      invoke,
      check: async () => {},
      status: async () => {},
    }),
  ).resolves.toBe("");
  expect(invoke).not.toHaveBeenCalled();
});
it("一轮请求超过预算时不丢已有证据，停止工具并直接进入最终回答", async () => {
  const calls = Array.from({ length: 33 }, (_, i) => ({
    id: String(i),
    name: "x",
    arguments: "{}",
  }));
  const turn = vi
    .fn()
    .mockResolvedValueOnce({ content: "", calls })
    .mockResolvedValueOnce({
      content: "已取得的数据；部分查询尚未完成",
      calls: [],
    });
  const invoke = vi.fn();
  await expect(
    runAssistantLoop({
      messages: [],
      tools: [{}],
      turn,
      invoke,
      check: async () => {},
      status: async () => {},
    }),
  ).resolves.toContain("部分查询尚未完成");
  expect(invoke).not.toHaveBeenCalled();
  expect(turn.mock.calls.at(-1)?.[1]).toEqual([]);
});
