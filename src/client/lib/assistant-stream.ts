import type { RagAssistantStreamEvent, RagMessageResult } from "../../shared/rag-conversations.ts";
import { apiStreamPost } from "./api.ts";

/** 有界、逐块解码；传输结束不意味着持久请求已经完成。 */
export async function streamAssistantMessage(path: string, body: unknown, onEvent: (event: RagAssistantStreamEvent) => void, signal?: AbortSignal): Promise<void> {
  const response = await apiStreamPost(path, body, signal);
  // 支持网关返回已有请求的 JSON 重放；不会伪造增量。
  if (response.headers.get("content-type")?.includes("application/json")) {
    onEvent({ type: "result", result: await response.json() as RagMessageResult });
    return;
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) throw new Error("Invalid assistant stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let tail = "", bufferedLength = 0, total = 0, finished = false;
  let parts: string[] = [];
  function dispatch(frame: string) {
    let name = "", data = "";
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      if (line.startsWith("data:")) data += `${line.slice(5).trimStart()}\n`;
    }
    if (!data) return;
    const event = JSON.parse(data) as RagAssistantStreamEvent;
    const valid = event && event.type === name && (
      ((event.type === "accepted" || event.type === "result") && !!event.result?.conversation && !!event.result?.message)
      || (event.type === "delta" && typeof event.text === "string") || event.type === "reset"
      || (event.type === "error" && typeof event.message === "string")
      || (event.type === "status" && ["thinking", "tool", "answering"].includes(event.phase)));
    if (!valid) throw new Error("Invalid assistant event");
    onEvent(event);
    if (event.type === "error") throw new Error(event.message);
    if (event.type === "result") finished = true;
  }
  try {
    while (!finished) {
      const { value, done } = await reader.read();
      if (value) total += value.byteLength;
      if (total > 1_000_000) throw new Error("Assistant stream limit exceeded");
      // 只在新分块及最多3字符的尾部查找分隔符，整帧仅在交付时拼接。
      let pending = tail + decoder.decode(value, { stream: !done });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(pending))) {
        if (bufferedLength + boundary.index > 65_536) throw new Error("Assistant event limit exceeded");
        const frame = parts.join("") + pending.slice(0, boundary.index);
        pending = pending.slice(boundary.index + boundary[0].length);
        parts = [];
        bufferedLength = 0;
        dispatch(frame);
        if (finished) break;
      }
      if (finished) break;
      // 尚未收齐的CRLF/LF分隔符不属于帧正文，不能使合法边界帧随分块方式被拒绝。
      const delimiterPrefix = /(?:\r\n\r|\r\n|\n\r|[\r\n])$/.exec(pending)?.[0].length ?? 0;
      if (bufferedLength + pending.length - delimiterPrefix > 65_536) throw new Error("Assistant event limit exceeded");
      const prefixLength = Math.max(0, pending.length - 3);
      if (prefixLength) {
        parts.push(pending.slice(0, prefixLength));
        bufferedLength += prefixLength;
      }
      tail = pending.slice(prefixLength);
      if (done) break;
    }
    if (!finished) throw new Error("Assistant stream interrupted");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
