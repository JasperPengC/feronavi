/** OpenAI-compatible native SSE adapter. Planning turns never deliver content. */
import { safeOutboundFetch } from "../lib/safe-fetch.ts";
export interface AssistantHooks {
  check(): Promise<void>;
  delta(text: string): Promise<void>;
  reset(): Promise<void>;
  signal?: AbortSignal;
  minDeltaChars?: number;
  timeoutMs?: number;
}
export interface ProviderCall {
  id: string;
  name: string;
  arguments: string;
}
export interface ProviderMessage {
  role: string;
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: unknown[];
}
export async function providerTurn(
  config: { baseUrl: string; apiKey: string; model: string },
  messages: ProviderMessage[],
  tools: unknown[],
  hooks: AssistantHooks,
  fetcher: typeof fetch = (url, init) =>
    safeOutboundFetch(String(url), {
      ...init,
      timeoutMs: hooks.timeoutMs ?? 45000,
    }),
): Promise<{ content: string; calls: ProviderCall[]; usage: number }> {
  // This vendor/model pair was probed with native SSE both with and without tools.
  // Do not forward a vendor-specific option to arbitrary OpenAI-compatible providers.
  let disableSparkThinking = false;
  try {
    const url = new URL(config.baseUrl);
    disableSparkThinking =
      url.protocol === "https:" &&
      url.hostname === "maas-api.cn-huabei-1.xf-yun.com" &&
      config.model === "spark-x2.6";
  } catch {
    /* The outbound URL guard reports invalid configuration. */
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    await hooks.check();
    if (attempt) await hooks.reset();
    let response: Response;
    try {
      response = await fetcher(
        `${config.baseUrl.replace(/\/$/u, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(config.apiKey
              ? { authorization: `Bearer ${config.apiKey}` }
              : {}),
          },
          body: JSON.stringify({
            model: config.model,
            messages,
            stream: true,
            ...(disableSparkThinking ? { enable_thinking: false } : {}),
            stream_options: { include_usage: true },
            max_tokens: 3000,
            ...(tools.length ? { tools, tool_choice: "auto" } : {}),
          }),
          signal: AbortSignal.any([
            AbortSignal.timeout(hooks.timeoutMs ?? 45000),
            ...(hooks.signal ? [hooks.signal] : []),
          ]),
        },
      );
    } catch (error) {
      if (hooks.signal?.aborted) throw error;
      if (
        attempt < 2 &&
        (error instanceof TypeError ||
          ["TimeoutError", "AbortError"].includes((error as Error).name))
      )
        continue;
      throw new Error("模型服务暂不可用", { cause: error });
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (
        attempt < 2 &&
        (response.status === 408 ||
          response.status === 429 ||
          response.status >= 500)
      )
        continue;
      throw new Error("模型服务暂不可用", {
        cause: { status: response.status },
      });
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("模型没有返回数据");
    let buffer = "",
      content = "",
      pending = "",
      bytes = 0,
      done = false;
    let usage = 0;
    const calls = new Map<number, ProviderCall>();
    try {
      const decoder = new TextDecoder();
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > 500000)
          throw new Error("模型响应超出限制", {
            cause: { code: "RESPONSE_LIMIT" },
          });
        buffer += decoder.decode(part.value, { stream: true });
        buffer = buffer.replace(/\r\n/gu, "\n");
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = frame
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n");
          if (!data) continue;
          if (data === "[DONE]") {
            done = true;
            break;
          }
          const parsed = JSON.parse(data) as {
            usage?: { total_tokens?: number };
            choices?: {
              finish_reason?: string;
              delta?: {
                content?: string;
                tool_calls?: {
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }[];
              };
            }[];
          };
          if (
            typeof parsed.usage?.total_tokens === "number" &&
            Number.isFinite(parsed.usage.total_tokens)
          )
            usage = Math.max(0, Math.floor(parsed.usage.total_tokens));
          if (parsed.choices?.[0]?.finish_reason === "length")
            throw new Error("模型回答达到长度限制", {
              cause: { code: "TOKEN_LIMIT" },
            });
          const delta = parsed.choices?.[0]?.delta;
          for (const call of delta?.tool_calls ?? []) {
            const current = calls.get(call.index) ?? {
              id: "",
              name: "",
              arguments: "",
            };
            current.id += call.id ?? "";
            current.name += call.function?.name ?? "";
            current.arguments += call.function?.arguments ?? "";
            if (calls.size >= 32 && !calls.has(call.index))
              throw Error("工具数量超限", {
                cause: { code: "TOOL_RESPONSE_LIMIT" },
              });
            calls.set(call.index, current);
          }
          if (delta?.content) {
            content += delta.content;
            if (!tools.length) {
              pending += delta.content;
              if (pending.length >= (hooks.minDeltaChars ?? 1)) {
                await hooks.check();
                await hooks.delta(pending);
                pending = "";
              }
            }
          }
        }
        if (done) break;
      }
      if (!done)
        throw new TypeError("network stream interrupted", {
          cause: { code: "INCOMPLETE_STREAM" },
        });
      if (pending) {
        await hooks.check();
        await hooks.delta(pending);
      }
      return { content, calls: [...calls.values()], usage };
    } catch (error) {
      if (
        attempt < 2 &&
        !hooks.signal?.aborted &&
        (error instanceof TypeError ||
          ["TimeoutError", "AbortError"].includes((error as Error).name))
      )
        continue;
      throw error;
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  throw new Error("模型服务暂不可用");
}
