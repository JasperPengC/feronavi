import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pageVisible: true,
  projectVisible: true,
  page: { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", projectId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", currentRevisionId: "cccccccc-cccc-cccc-cccc-cccccccccccc", deletedAt: null },
  jobs: [{ id: "job-1", status: "SUCCEEDED" }],
  chunks: [{ id: "chunk-1", headingPath: "指南 > 备份", content: "备份数据库", tokenCount: 8, createdAt: new Date(0), hasVector: true }],
  queryTables: [] as string[],
  db: { select: vi.fn() },
}));

vi.mock("../src/db/index.ts", () => ({ db: state.db }));
vi.mock("../src/server/services/wiki.service.ts", () => ({ visiblePageCondition: vi.fn(async () => ({})) }));
vi.mock("../src/server/repos/project.repo.ts", () => ({ isVisibleTo: vi.fn(async () => state.projectVisible) }));
vi.mock("../src/server/services/setting.service.ts", () => ({ getSettingRaw: vi.fn(async () => 7) }));
vi.mock("../src/server/services/ai-config.service.ts", () => ({ addUsage: vi.fn(), canStartIndexing: vi.fn() }));

function installDb() {
  state.db.select.mockImplementation(() => {
    let tableName = "";
    const query: Record<string, (...args: unknown[]) => unknown> = {
      from(table) {
        tableName = table === page ? "page" : table === pageChunk ? "page_chunk" : table === indexJob ? "index_job" : "other";
        state.queryTables.push(tableName);
        return query;
      },
      where() { return query; },
      limit() {
        if (tableName === "page") return Promise.resolve(state.pageVisible ? [state.page] : []);
        if (tableName === "index_job") return Promise.resolve(state.jobs);
        return Promise.resolve([]);
      },
      orderBy() { return tableName === "page_chunk" ? Promise.resolve(state.chunks) : query; },
    };
    return query;
  });
}

import { listJobs, listPageChunks } from "../src/server/services/knowledge.service.ts";
import type { Actor } from "../src/server/permission/actor.ts";
import { page, pageChunk, indexJob } from "../src/db/schema.ts";

const admin: Actor = {
  memberId: "admin", username: "admin", name: "Admin", permissions: new Set(),
  grants: [{ roleKey: "ADMIN", scopeType: "ORG", scopeId: null }],
  mustChangePassword: false, locale: "zh-CN", timezone: "Asia/Shanghai", theme: null,
};
const member: Actor = {
  memberId: "member", username: "member", name: "Member", permissions: new Set(),
  grants: [{ roleKey: "MEMBER", scopeType: "PROJECT", scopeId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }],
  mustChangePassword: false, locale: "zh-CN", timezone: "Asia/Shanghai", theme: null,
};

beforeEach(() => {
  state.pageVisible = true;
  state.projectVisible = true;
  state.queryTables.length = 0;
  installDb();
});

describe("page knowledge data visibility", () => {
  it("lets a project member read index jobs for a visible page", async () => {
    await expect(listJobs(member, state.page.id)).resolves.toEqual(state.jobs);
    expect(state.queryTables).toContain("page");
    expect(state.queryTables).toContain("index_job");
  });

  it("hides restricted page jobs from a member without page access", async () => {
    state.pageVisible = false;
    await expect(listJobs(member, state.page.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.queryTables).toEqual(["page"]);
  });

  it("allows administrators and returns only safe fields for current page chunks", async () => {
    const result = await listPageChunks(admin, state.page.id);
    expect(result).toMatchObject({ generation: 7, revisionId: state.page.currentRevisionId });
    expect(result.chunks).toEqual([state.chunks[0]]);
    expect(Object.keys(result.chunks[0]!)).not.toContain("contentHash");
    expect(Object.keys(result.chunks[0]!)).not.toContain("vector");
    expect(state.queryTables).toContain("page_chunk");
  });

  it("does not return chunk previews to users outside the page project scope", async () => {
    state.projectVisible = false;
    await expect(listPageChunks(member, state.page.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.queryTables).toEqual(["page"]);
  });
});
