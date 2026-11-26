import { describe, expect, it } from "vitest";
import type { RagMessage } from "../src/shared/rag-conversations.ts";
import type { RagActionProposal } from "../src/shared/rag.ts";
import { projectAgentExecution } from "../src/shared/agent-execution.ts";
const now = Date.parse("2026-11-25T14:00:00Z");
const action = (patch: Partial<RagActionProposal> = {}): RagActionProposal => ({
  id: "step-1", toolName: "workitem.comment", projectId: "project", targetId: "item",
  parameters: {}, expectedVersion: null, status: "pending", createdAt: "2026-11-25T13:00:00Z",
  expiresAt: "2026-11-25T15:00:00Z", ...patch,
});
const message = (actions: RagActionProposal[]): RagMessage => ({
  id: "message", conversationId: "conversation", requestId: "run", question: "交付步骤", status: "completed",
  reply: { ok: true, answer: "", mode: "none", citations: [], scope: { projectIds: ["project"], projectCount: 1 }, actions },
  createdAt: "2026-11-25T13:00:00Z", updatedAt: "2026-11-25T13:01:00Z",
});
describe("运行状态来自持久业务事实", () => {
  it("保留被替代步骤的历史，但不把已完成的修正运行显示成部分完成", () => {
    const run = projectAgentExecution(message([
      action({ status: "rejected", supersededById: "step-2" }),
      action({ id: "step-2", supersedesId: "step-1", status: "confirmed", result: { observedAt: "2026-11-25T13:01:00Z", resources: [], value: {} } }),
    ]), now);
    expect(run).toMatchObject({ status: "VERIFIED", verifiedCount: 1, remainingCount: 0 });
    expect(run.steps.map(s => s.status)).toEqual(["SUPERSEDED", "VERIFIED"]);
  });
  it("已提交审批不能显示已完成，缺回读结果不能显示已核验", () => {
    const run = projectAgentExecution(message([
      action({ status: "confirmed", result: { observedAt: "2026-11-25T13:01:00Z", resources: [], value: {}, outcome: "approval_pending", approval: { status: "PENDING" } } }),
      action({ id: "step-2", status: "confirmed" }),
    ]), now);
    expect(run.steps.map(s => s.status)).toEqual(["WAITING_APPROVAL", "EXECUTED"]);
    expect(run.verifiedCount).toBe(0);
    expect(run.status).toBe("WAITING_APPROVAL");
  });
  it("同一运行保留已完成步骤，后续失败显示部分完成", () => {
    const run = projectAgentExecution(message([
      action({ status: "confirmed", result: { observedAt: "2026-11-25T13:01:00Z", resources: [], value: {} } }),
      action({ id: "step-2", status: "failed" }),
    ]), now);
    expect(run).toMatchObject({ runId: "run", status: "PARTIAL", verifiedCount: 1, remainingCount: 1 });
    expect(run.steps[0]).toMatchObject({ stepId: "step-1", status: "VERIFIED" });
    expect(run.steps[1]).toMatchObject({ stepId: "step-2", status: "FAILED" });
  });
  it.each(["queued", "running", "uncertain", "rejected", "expired"] as const)("保留%s语义", status => {
    const expected = { queued: "QUEUED", running: "RUNNING", uncertain: "UNCERTAIN", rejected: "CANCELLED", expired: "EXPIRED" }[status];
    expect(projectAgentExecution(message([action({ status })]), now).steps[0]!.status).toBe(expected);
  });
  it("过期、空运行与失权不推断成功，隐藏的步骤不泄露", () => {
    expect(projectAgentExecution(message([action({ expiresAt: "2000-01-01T00:00:00Z" })]), now).status).toBe("EXPIRED");
    expect(projectAgentExecution(message([]), now).status).toBe("EMPTY");
    expect(projectAgentExecution({ ...message([action()]), status: "unavailable", reply: null }, now)).toMatchObject({ status: "UNAVAILABLE", steps: [] });
  });
});
