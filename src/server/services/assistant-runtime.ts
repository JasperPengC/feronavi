import type { ProviderCall, ProviderMessage } from "./assistant-provider.ts";
/** Tool count, rounds, response sizes and wall time are independently bounded. */
export async function runAssistantLoop(options: {
  messages: ProviderMessage[];
  tools: unknown[] | (() => unknown[]);
  turn: (
    messages: ProviderMessage[],
    tools: unknown[],
  ) => Promise<{ content: string; calls: ProviderCall[] }>;
  invoke: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  toolName?: (name: string) => string;
  retryIncompletePlan?: (content: string) => string | undefined;
  check: () => Promise<void>;
  status: (
    phase: "thinking" | "tool" | "answering",
    toolName?: string,
  ) => Promise<void>;
}) {
  const { messages } = options;
  let count = 0;
  let corrected = false;
  for (let round = 0; round < 6; round++) {
    await options.check();
    await options.status("thinking");
    const tools = typeof options.tools === "function" ? options.tools() : options.tools;
    if (tools.length > 128) throw Error("模型工具超过128项");
    const result = await options.turn(messages, tools);
    if (!result.calls.length) {
      const correction = !corrected && options.retryIncompletePlan?.(result.content);
      if (correction) {
        corrected = true;
        messages.push({ role: "assistant", content: result.content }, { role: "user", content: correction });
        continue;
      }
      break;
    }
    if (count + result.calls.length > 32 || result.calls.length > 16) {
      messages.push({
        role: "user",
        content:
          "工具查询预算已耗尽。保留已取得的证据直接回答；对未完成的查询明确说明不足，绝不能猜测。",
      });
      break;
    }
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: result.calls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.arguments },
      })),
    });
    for (const call of result.calls) {
      await options.check();
      count++;
      await options.status(
        "tool",
        options.toolName?.(call.name) ?? call.name.replaceAll("_", "."),
      );
      if (call.arguments.length > 12000) throw Error("工具参数超出限制");
      let value: unknown;
      try {
        const args = JSON.parse(call.arguments);
        if (!args || Array.isArray(args) || typeof args !== "object")
          throw Error("参数必须为对象");
        value = await options.invoke(
          call.name,
          args as Record<string, unknown>,
        );
      } catch {
        value = {
          error: "工具不可用、参数不合法或权限不足；不能据此猜测业务事实。",
        };
      }
      const content = JSON.stringify(value);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content:
          content.length > 40000
            ? JSON.stringify({
                truncated: true,
                note: "结果超出限制，请缩小查询或分页",
                preview: content.slice(0, 35000),
              })
            : content,
      });
    }
  }
  await options.check();
  await options.status("answering");
  messages.push({
    role: "user",
    content:
      "现在依据已获取的实时证据给出最终答案。不可再调用工具；注明数据时间及中文业务来源；仅在问题涉及延期/落后时说明相关基准。计划日期采用服务端dateFacts，今天到期不等于逾期或已完成。计划完成/归档与日期按逐节点lifecycleFacts.statement分别陈述，混合状态不得合并为均已完成/已闭环，也不得跨节点转移状态；节点逾期不得泛化为全项目落后，未经关联覆盖与预期进度基准核验则整体是否落后未知。用中文业务名/key，不回显内部执行字段、UUID或函数别名；已有操作卡则简短引导确认，不重复整卡。不要输出内部规划。",
  });
  return (await options.turn(messages, [])).content;
}
