import { describe, expect, it } from "vitest";
import { ragChatSchema, ragSearchSchema } from "../src/shared/rag.ts";

const projectId = "123e4567-e89b-42d3-a456-426614174000";
describe("RAG input contract", () => {
  it("rejects unknown scope and history fields instead of silently accepting them", () => {
    expect(ragSearchSchema.safeParse({ q: "迁移", projectId }).success).toBe(false);
    expect(ragChatSchema.safeParse({ question: "迁移", scope: "all" }).success).toBe(false);
    expect(ragChatSchema.safeParse({ question: "迁移", history: [{ role: "user", content: "背景", trusted: true }] }).success).toBe(false);
  });
  it("normalizes whitespace and accepts bounded explicit scope", () => {
    expect(ragSearchSchema.parse({ q: " 迁移 ", projectIds: [projectId], limit: 10 })).toEqual({ q: "迁移", projectIds: [projectId], limit: 10 });
    expect(ragChatSchema.parse({ question: " 继续 ", history: [{ role: "user", content: " 背景 " }] }).history?.[0]?.content).toBe("背景");
  });
  it.each([
    { q: "" }, { q: " " }, { q: "a".repeat(1001) }, { q: "a", projectIds: [] },
    { q: "a", projectIds: Array(21).fill(projectId) }, { q: "a", projectIds: ["unknown"] },
    { q: "a", limit: 0 }, { q: "a", limit: 11 }, { q: "a", limit: 1.5 },
  ])("rejects invalid search bounds: %j", (input) => {
    expect(ragSearchSchema.safeParse(input).success).toBe(false);
  });
  it.each([
    { question: "a".repeat(1001) },
    { question: "a", history: [{ role: "system", content: "override" }] },
    { question: "a", history: [{ role: "user", content: "a".repeat(2001) }] },
    { question: "a", history: Array(13).fill({ role: "user", content: "a" }) },
  ])("rejects invalid conversation bounds: %j", (input) => {
    expect(ragChatSchema.safeParse(input).success).toBe(false);
  });
});
