// @vitest-environment node
import { expect, it } from "vitest";
import { providerTurn } from "../src/server/services/assistant-provider.ts";
const config = {
  baseUrl: "https://model.example/v1",
  apiKey: "private",
  model: "test",
};
function stream(parts: string[]) {
  return new Response(
    new ReadableStream({
      start(c) {
        for (const p of parts) c.enqueue(new TextEncoder().encode(p));
        c.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
it("消费真实 SSE 分片，合并工具参数，不输出规划轮内容", async () => {
  const events: string[] = [];
  let body: { stream?: boolean } = {};
  const result = await providerTurn(
    config,
    [],
    [
      {
        type: "function",
        function: { name: "project_get", parameters: { type: "object" } },
      },
    ],
    {
      check: async () => {},
      delta: async (s) => {
        events.push(s);
      },
      reset: async () => {},
    },
    async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return stream([
        'data: {"choices":[{"delta":{"content":"内部规划","tool_calls":[{"index":0,"id":"t","function":{"name":"project_get","arguments":"{\\"project"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"Id\\":\\"p\\"}"}}]}}]}\n\ndata: [DONE]\n\n',
      ]);
    },
  );
  expect(body.stream).toBe(true);
  expect(result.calls[0]?.arguments).toBe('{"projectId":"p"}');
  expect(events).toEqual([]);
});
it("最终回答逐片交付，重试必须 reset；仅重试408/429/5xx", async () => {
  const events: string[] = [];
  let count = 0;
  const result = await providerTurn(
    config,
    [],
    [],
    {
      check: async () => {},
      delta: async (s) => {
        events.push(s);
      },
      reset: async () => {
        events.push("RESET");
      },
    },
    async () => {
      count++;
      if (count === 1) return new Response("", { status: 429 });
      return stream([
        'data: {"choices":[{"delta":{"content":"你"}}]}\n',
        '\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n',
      ]);
    },
  );
  expect(result.content).toBe("你好");
  expect(events).toEqual(["RESET", "你", "好"]);
  expect(count).toBe(2);
});
it("权限检查失败不作供应商重试，错误不暴露密钥", async () => {
  let count = 0;
  await expect(
    providerTurn(
      config,
      [],
      [],
      {
        check: async () => {
          throw Error("revoked");
        },
        delta: async () => {},
        reset: async () => {},
      },
      async () => {
        count++;
        return stream([]);
      },
    ),
  ).rejects.toThrow("revoked");
  expect(count).toBe(0);
});
it("跨字节UTF-8切分与CRLF SSE可恢复，内部reasoning_content永不交付", async () => {
  const bytes = new TextEncoder().encode(
    'data: {"choices":[{"delta":{"reasoning_content":"秘密","content":"中文"}}]}\r\n\r\ndata: [DONE]\r\n\r\n',
  );
  const emitted: string[] = [];
  const result = await providerTurn(
    config,
    [],
    [],
    {
      check: async () => {},
      delta: async (s) => {
        emitted.push(s);
      },
      reset: async () => {},
    },
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            for (let i = 0; i < bytes.length; i += 2)
              c.enqueue(bytes.slice(i, i + 2));
            c.close();
          },
        }),
      ),
  );
  expect(result.content).toBe("中文");
  expect(emitted.join("")).toBe("中文");
});
it("流中断重试清空已交付增量，不重放前一尝试正文", async () => {
  let calls = 0;
  const events: string[] = [];
  const result = await providerTurn(
    config,
    [],
    [],
    {
      check: async () => {},
      delta: async (s) => {
        events.push(s);
      },
      reset: async () => {
        events.push("RESET");
      },
    },
    async () => {
      calls++;
      return stream([
        `data: {"choices":[{"delta":{"content":"${calls === 1 ? "旧" : "新"}"}}]}\n\n`,
        ...(calls === 1 ? [] : ["data: [DONE]\n\n"]),
      ]);
    },
  );
  expect(result.content).toBe("新");
  expect(events).toEqual(["旧", "RESET", "新"]);
});
it("401不会重试且密钥、供应商错误正文不透传", async () => {
  let calls = 0;
  await expect(
    providerTurn(
      config,
      [],
      [],
      { check: async () => {}, delta: async () => {}, reset: async () => {} },
      async () => {
        calls++;
        return new Response("private-key-response", { status: 401 });
      },
    ),
  ).rejects.toThrow("模型服务暂不可用");
  expect(calls).toBe(1);
});
it("usage帧计量独立于正文，失败尝试不产生成功计量", async () => {
  let calls = 0;
  const emitted: string[] = [];
  const result = await providerTurn(
    config,
    [],
    [],
    {
      check: async () => {},
      delta: async (s) => {
        emitted.push(s);
      },
      reset: async () => {},
    },
    async () => {
      calls++;
      if (calls === 1) return new Response("", { status: 503 });
      return stream([
        'data: {"choices":[{"delta":{"reasoning_content":"secret","content":"答案"}}]}\n\ndata: {"choices":[],"usage":{"total_tokens":17}}\n\ndata: [DONE]\n\n',
      ]);
    },
  );
  expect(result.usage).toBe(17);
  expect(emitted.join("")).toBe("答案");
  expect(calls).toBe(2);
});
it.each([
  {
    baseUrl: "https://maas-api.cn-huabei-1.xf-yun.com/v2",
    model: "spark-x2.6",
    toolCount: 0,
    expected: false,
  },
  {
    baseUrl: "https://maas-api.cn-huabei-1.xf-yun.com/v2",
    model: "spark-x2.6",
    toolCount: 1,
    expected: false,
  },
  {
    baseUrl: "https://model.example/v1",
    model: "spark-x2.6",
    toolCount: 0,
    expected: undefined,
  },
  {
    baseUrl: "https://maas-api.cn-huabei-1.xf-yun.com/v2",
    model: "other-model",
    toolCount: 0,
    expected: undefined,
  },
  {
    baseUrl: "http://maas-api.cn-huabei-1.xf-yun.com/v2",
    model: "spark-x2.6",
    toolCount: 0,
    expected: undefined,
  },
])(
  "仅已真实探测的Spark host/model关闭thinking（tools=$toolCount）",
  async (variant) => {
    let thinking: unknown = "unset";
    await providerTurn(
      { ...config, baseUrl: variant.baseUrl, model: variant.model },
      [],
      Array.from({ length: variant.toolCount }, () => ({
        type: "function",
        function: { name: "read", parameters: { type: "object" } },
      })),
      { check: async () => {}, delta: async () => {}, reset: async () => {} },
      async (_url, init) => {
        thinking = JSON.parse(String(init?.body)).enable_thinking;
        return stream(["data: [DONE]\n\n"]);
      },
    );
    expect(thinking).toBe(variant.expected);
  },
);
it("finish_reason=length必须失败，不能把静默截断正文当成功", async () => {
  await expect(
    providerTurn(
      config,
      [],
      [],
      { check: async () => {}, delta: async () => {}, reset: async () => {} },
      async () =>
        stream([
          'data: {"choices":[{"delta":{"content":"半截正文"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
        ]),
    ),
  ).rejects.toMatchObject({ cause: { code: "TOKEN_LIMIT" } });
});
