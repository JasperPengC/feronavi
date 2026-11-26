import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AssistantExecution } from "../src/client/components/assistant/AssistantExecution.tsx";
import { AssistantActionStatus } from "../src/client/components/assistant/AssistantActionStatus.tsx";
import { setLocale } from "../src/client/i18n/index.ts";
import type { RagMessage } from "../src/shared/rag-conversations.ts";
import type { RagActionProposal } from "../src/shared/rag.ts";
setLocale("zh-CN");
afterEach(() => { cleanup(); vi.useRealTimers(); });
const step: RagActionProposal = { id: "step-a", toolName: "workitem.comment", projectId: "project", targetId: "item", parameters: {}, expectedVersion: null, status: "confirmed", createdAt: "2026-11-25T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", result: { observedAt: "2026-11-25T00:01:00Z", resources: [], value: {} } };
const message: RagMessage = { id: "message", conversationId: "conversation", requestId: "run", question: "回写验收", status: "completed", createdAt: step.createdAt, updatedAt: step.createdAt, reply: { ok: true, answer: null, citations: [], mode: "none", scope: { projectIds: ["project"], projectCount: 1 }, actions: [step, { ...step, id: "step-b", status: "pending", result: undefined }] } };
it("整轮展示完成与待处理数量，回读只触发读取入口并提供步骤定位", async () => {
  const refresh = vi.fn(async () => {});
  render(<AssistantExecution message={message} onRefresh={refresh} />);
  expect(screen.getByText("已核验 1 · 待处理 1")).toBeTruthy();
  expect(screen.getByText("部分完成").closest(".wi-tag")?.getAttribute("data-tone")).toBe("warning");
  expect(screen.getAllByRole("link")[0]!.getAttribute("href")).toBe("#assistant-action-step-a");
  fireEvent.click(screen.getByRole("button", { name: "回读执行记录" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(screen.queryByRole("button", { name: "确认执行" })).toBeNull();
});
it("审批已提交保持橙色，缺少回读证据不会显示绿色完成", () => {
  const { rerender } = render(<AssistantActionStatus action={{ ...step, result: { ...step.result!, outcome: "approval_pending" } }} />);
  expect(screen.getByRole("status").textContent).toBe("审批已提交");
  expect(screen.getByRole("status").querySelector(".wi-tag")?.getAttribute("data-tone")).toBe("warning");
  rerender(<AssistantActionStatus action={{ ...step, result: undefined }} />);
  expect(screen.getByRole("status").textContent).toBe("已执行 · 待核验");
  expect(screen.getByRole("status").querySelector(".wi-tag")?.getAttribute("data-tone")).toBe("warning");
});
it("确认期限到达时摘要和步骤自动显示过期，不需要手动回读", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-25T00:00:00Z"));
  render(<AssistantExecution message={{ ...message, reply: { ...message.reply!, actions: [{ ...step, status: "pending", expiresAt: "2026-11-25T00:00:01Z", result: undefined }] } }} />);
  expect(screen.getAllByText("待确认")).toHaveLength(2);
  act(() => { vi.advanceTimersByTime(1001); });
  expect(screen.queryByText("待确认")).toBeNull();
  expect(screen.getAllByText("已过期")).toHaveLength(2);
});
