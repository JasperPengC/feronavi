// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Actor } from "../src/server/permission/actor.ts";

// 外部数据库及副作用不属于协议边界测试；保留真实注册表、引擎和服务输入解析。
vi.mock("../src/db/index.ts", () => ({ db: {}, sql: {} }));
vi.mock("../src/server/services/mcp-client.service.ts", () => ({ recordToolCall: async () => {}, assertToolPolicyAllowed: async () => {} }));
const collabRoomMock = vi.hoisted(() => {
  const room = {
    id: "44444444-4444-4444-8444-444444444444",
    resourceType: "WORK_ITEM",
    resourceId: "11111111-1111-4111-8111-111111111111",
    projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    mode: "COMMAND",
    baseRevisionId: null,
  };
  return {
    room,
    getOrCreateRoom: vi.fn(async () => room),
    getRoom: vi.fn(async () => room),
    canWriteRoom: vi.fn(async () => false),
  };
});
vi.mock("../src/server/services/collab-room.persistence.ts", () => collabRoomMock);
vi.mock("../src/server/services/collab-document.service.ts", () => ({ loadDocument: async () => ({ sequence: 0 }) }));
vi.mock("../src/server/services/mcp-resource.service.ts", () => ({
  projectForMcpResource: async (_kind: string, id: string) => id === "11111111-1111-4111-8111-111111111111" ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
}));
vi.mock("../src/server/services/work-item.service.ts", () => ({
  createWorkItem: async (_actor: Actor, projectId: string, input: object) => ({ projectId, ...input }),
  getWorkItem: async () => ({ id: "11111111-1111-4111-8111-111111111111", projectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", version: 1 }),
  updateWorkItem: async (_actor: Actor, id: string, patch: object) => ({ id, ...patch }),
}));
import { AGENT_TOOLS } from "../src/server/mcp/tools.ts";
import { buildMcpServer, TOOLS, WRITE_TOOLS } from "../src/server/mcp/server.ts";

const projectA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const projectB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const actor: Actor = { memberId: "m", username: "m", name: "m", permissions: new Set(["work_item:create", "work_item:update_any"]), grants: [{ roleKey: "ADMIN", scopeType: "ORG", scopeId: null }], rolePermissions: new Map([["ADMIN", new Set(["work_item:create", "work_item:update_any"])]]), mustChangePassword: false, locale: "zh-CN", timezone: null, theme: null };
const clients: Client[] = [];
afterEach(async () => { await Promise.all(clients.splice(0).map((client) => client.close())); });
async function connect(projectWhitelist: string[] = []) {
  const server = buildMcpServer({ actor, token: { memberId: "m", tokenId: "token", tier: "ADMIN", projectWhitelist } });
  const client = new Client({ name: "contract-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  clients.push(client);
  return client;
}
function envelope(result: Awaited<ReturnType<Client["callTool"]>>) {
  return JSON.parse((result.content as { text: string }[])[0]!.text);
}

describe("MCP 服务端执行声明的输入契约", () => {
  it("工具目录声明结构化输出和安全操作提示", async () => {
    const client = await connect();
    const listed = await client.listTools();
    expect(listed.tools.length).toBeGreaterThan(0);
    for (const tool of listed.tools) {
      expect(tool.outputSchema, tool.name).toMatchObject({ type: "object" });
      expect(tool.annotations, tool.name).toMatchObject({
        readOnlyHint: expect.any(Boolean),
        destructiveHint: expect.any(Boolean),
        idempotentHint: expect.any(Boolean),
      });
    }
    expect(listed.tools.find(tool => tool.name === "ping")?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    expect(listed.tools.find(tool => tool.name === "workitem.create")?.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: false });
    expect(listed.tools.find(tool => tool.name === "comment.delete")?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    const ping = await client.callTool({ name: "ping", arguments: {} });
    expect(ping.structuredContent).toEqual({ ok: true, server: "feronavi" });
    expect(envelope(ping)).toEqual(ping.structuredContent);
    const invalid = await client.callTool({ name: "ping", arguments: { unexpected: true } });
    expect(invalid.isError).toBe(true);
    expect(envelope(invalid).code).toBe("VALIDATION");
  });

  it("未知字段在进入业务处理前返回 VALIDATION", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "workitem.update", arguments: { workItemId: "11111111-1111-4111-8111-111111111111", expectedVersion: 1, statusId: "22222222-2222-4222-8222-222222222222" } });
    expect(envelope(result).code).toBe("VALIDATION");
  });
  it("字符串不能冒充数字，uuid 和枚举也必须合法", async () => {
    const client = await connect();
    for (const args of [{ projectId: projectA, type: "TASK", title: "x", estimatePoints: "3" }, { projectId: "bad", type: "TASK", title: "x" }, { projectId: projectA, type: "UNKNOWN", title: "x" }]) {
      expect(envelope(await client.callTool({ name: "workitem.create", arguments: args })).code).toBe("VALIDATION");
    }
  });
  it("所有读写工具都拒绝未声明的顶层字段", async () => {
    const client = await connect();
    for (const tool of [...TOOLS, ...WRITE_TOOLS]) {
      const result = await client.callTool({ name: tool.name, arguments: { undeclaredField: true } });
      expect(envelope(result).code, tool.name).toBe("VALIDATION");
    }
  });
  it("所有写工具声明必填确认，旧工具也在业务执行前拒绝未确认写入", async () => {
    for (const tool of [...WRITE_TOOLS, ...AGENT_TOOLS].filter(tool => tool.kind === "write")) {
      expect(tool.inputSchema.required, tool.name).toContain("userConfirmed");
    }
    const client = await connect();
    const args = { projectId: projectA, type: "TASK", title: "unconfirmed" };
    expect(envelope(await client.callTool({ name: "workitem.create", arguments: args })).code).toBe("VALIDATION");
    expect(envelope(await client.callTool({ name: "workitem.create", arguments: { ...args, userConfirmed: false } })).code).toBe("COMMAND_CONFIRMATION_REQUIRED");
  });
  it("合法创建仍执行成功", async () => {
    const result = await (await connect()).callTool({ name: "workitem.create", arguments: { projectId: projectA, type: "TASK", title: "valid", userConfirmed: true } });
    expect(result.isError).not.toBe(true);
    expect(envelope(result).result).toMatchObject({ projectId: projectA, title: "valid" });
  });
  it("项目白名单之外的创建拒绝，即使账号是组织管理员", async () => {
    const result = await (await connect([projectA])).callTool({ name: "workitem.create", arguments: { projectId: projectB, type: "TASK", title: "outside", userConfirmed: true } });
    expect(envelope(result).code).toBe("NOT_FOUND");
  });
});

describe("MCP 协作房间冷启动", () => {
  it("inspect 首次访问自动创建 COMMAND 房间并返回可执行动作", async () => {
    collabRoomMock.getOrCreateRoom.mockClear();
    const result = await (await connect()).callTool({ name: "collab.inspect", arguments: { resourceType: "WORK_ITEM", resourceId: inside } });
    const data = envelope(result);
    expect(result.isError).not.toBe(true);
    expect(collabRoomMock.getOrCreateRoom).toHaveBeenCalledWith(actor, "WORK_ITEM", inside);
    expect(data).toMatchObject({ mode: "COMMAND", actions: ["workitem.get", "workitem.update", "workitem.transition", "workitem.assign", "workitem.comment"] });
  });

  it("未确认的command在创建房间前拒绝", async () => {
    collabRoomMock.getOrCreateRoom.mockClear();
    const result = await (await connect()).callTool({ name: "collab.command", arguments: {
      resourceType: "WORK_ITEM", resourceId: inside, action: "workitem.update", input: { expectedVersion: 1, title: "冷启动验证" }, userConfirmed: false,
    } });
    expect(collabRoomMock.getOrCreateRoom).not.toHaveBeenCalled();
    expect(envelope(result).code).toBe("COMMAND_CONFIRMATION_REQUIRED");
  });
});

const inside = "11111111-1111-4111-8111-111111111111";
const outside = "22222222-2222-4222-8222-222222222222";
const resourceCalls: [string, Record<string, unknown>][] = [
  ["workitem.update", { workItemId: outside, expectedVersion: 1 }],
  ["workitem.comment", { workItemId: outside, body: "x" }],
  ["workitem.link", { fromWorkItemId: inside, toWorkItemId: outside, type: "RELATES_TO" }],
  ["workitem.link", { fromWorkItemId: outside, toWorkItemId: inside, type: "RELATES_TO" }],
  ["comment.update", { commentId: outside, body: "x" }],
  ["comment.delete", { commentId: outside }],
  ["page.update", { pageId: outside, title: "x", expectedRevisionId: "33333333-3333-4333-8333-333333333333", userConfirmed: true }],
  ["idea.vote", { ideaId: outside }],
  ["idea.promote", { ideaId: outside }],
  ["approval.approve", { approvalId: outside }],
  ["approval.reject", { approvalId: outside }],
  ["workitem.create", { projectId: projectA, type: "TASK", title: "x", milestoneId: outside }],
  ["page.create", { projectId: projectA, title: "x", parentId: outside }],
  ["plan.createModule", { projectId: projectA, name: "x", parentId: outside }],
];
for (const [name, args] of resourceCalls) {
  it(`${name} 按实际资源所属项目拒绝白名单外访问 ${JSON.stringify(args)}`, async () => {
    const result = await (await connect([projectA])).callTool({ name, arguments: name === "notification.list" ? args : { userConfirmed: true, ...args } });
    expect(envelope(result).code).toBe("NOT_FOUND");
  });
}
it("受限项目令牌不能读取全账号通知或发送全局公告", async () => {
  const client = await connect([projectA]);
  for (const [name, args] of [["notification.list", {}], ["notification.markRead", {}], ["announcement.send", { title: "x", body: "x" }], ["announcement.revoke", { announcementId: outside }]] as const) {
    expect(envelope(await client.callTool({ name, arguments: name === "notification.list" ? args : { userConfirmed: true, ...args } })).code).toBe("FORBIDDEN");
  }
});
it("MCP 校验嵌套额外字段和动态布尔值，不能只校验顶层对象", async () => {
  const client = await connect();
  expect(envelope(await client.callTool({ name: "announcement.send", arguments: { userConfirmed: true, title: "x", body: "x", audience: { undeclaredField: true } } })).code).toBe("VALIDATION");
  expect(envelope(await client.callTool({ name: "notification.setPrefs", arguments: { userConfirmed: true, categoryPrefs: { ASSIGN: { inApp: "yes" } } } })).code).toBe("VALIDATION");
});

it.each([{ actions: [{}] }, { conditions: { all: 123 } }, { actions: [{ type: "CALL_WEBHOOK", hidden: true }] }])("自动化 MCP 在服务执行前拒绝非法嵌套结构 %j", async (bad) => {
  const client = await connect();
  const result = await client.callTool({ name: "automation.createRule", arguments: { userConfirmed: true, projectId: projectA, name: "bad", trigger: "SCHEDULE", actions: [{ type: "CALL_WEBHOOK" }], ...bad } });
  expect(envelope(result).code).toBe("VALIDATION");
});
