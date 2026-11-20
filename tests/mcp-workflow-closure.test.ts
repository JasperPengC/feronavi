// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Actor } from "../src/server/permission/actor.ts";

const mocks = vi.hoisted(() => {
  const item = { id: "11111111-1111-4111-8111-111111111111", projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", version: 1 };
  return {
    item,
    transition: vi.fn(async (_actor: unknown, id: string, input: object) => ({ id, ...input, version: 2 })),
    comments: vi.fn(async (_actor: unknown, _type: string, _id: string, opts: { parentId?: string | null }) => [{ id: opts.parentId ? "reply" : "top", parentId: opts.parentId }]),
    room: { id: "44444444-4444-4444-8444-444444444444", resourceType: "WORK_ITEM", resourceId: item.id, projectId: item.projectId, mode: "COMMAND" },
  };
});
vi.mock("../src/db/index.ts", () => ({ db: {}, sql: {} }));
vi.mock("../src/server/services/mcp-client.service.ts", () => ({ recordToolCall: async () => {}, assertToolPolicyAllowed: async () => {} }));
vi.mock("../src/server/services/mcp-resource.service.ts", () => ({ projectForMcpResource: async () => mocks.item.projectId }));
vi.mock("../src/server/services/work-item.service.ts", () => ({ getWorkItem: async () => mocks.item, transitionWorkItem: mocks.transition }));
vi.mock("../src/server/services/comment.service.ts", () => ({ listComments: mocks.comments }));
vi.mock("../src/server/services/collab-room.persistence.ts", () => ({ getOrCreateRoom: async () => mocks.room, getRoom: async () => mocks.room }));
vi.mock("../src/server/services/collab-document.service.ts", () => ({ publishRoomEvent: async () => {} }));
vi.mock("../src/server/services/event-log.ts", () => ({ recordBusinessEvent: async () => {} }));
import { buildMcpServer } from "../src/server/mcp/server.ts";

const permissions = new Set(["work_item:transition"]);
const actor: Actor = { memberId: "m", username: "m", name: "m", permissions, grants: [{ roleKey: "ADMIN", scopeType: "ORG", scopeId: null }], rolePermissions: new Map([["ADMIN", permissions]]), mustChangePassword: false, locale: "zh-CN", timezone: null, theme: null };
const clients: Client[] = [];
beforeEach(() => { mocks.transition.mockClear(); mocks.comments.mockClear(); });
afterEach(async () => { await Promise.all(clients.splice(0).map(client => client.close())); });
async function connect() {
  const server = buildMcpServer({ actor, token: { memberId: "m", tokenId: "token", tier: "READ_WRITE", projectWhitelist: [mocks.item.projectId] } });
  const client = new Client({ name: "workflow-closure", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport); clients.push(client);
  return client;
}
const body = (result: Awaited<ReturnType<Client["callTool"]>>) => JSON.parse((result.content as { text: string }[])[0]!.text);

it.each(["workitem.transition", "collab.command"])("%s 将迁移必填字段完整传给共享业务服务", async name => {
  const fields = { reason: "测试通过", evidence: { checked: true }, count: 0 };
  const args = name === "workitem.transition" ? { workItemId: mocks.item.id, toStateKey: "DONE", version: 1, fields, userConfirmed: true }
    : { resourceType: "WORK_ITEM", resourceId: mocks.item.id, action: "workitem.transition", input: { toStateKey: "DONE", version: 1, fields }, userConfirmed: true };
  const result = await (await connect()).callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(body(result))).not.toBe(true);
  expect(mocks.transition).toHaveBeenCalledWith(actor, mocks.item.id, expect.objectContaining({ toStateKey: "DONE", version: 1, fields }));
});

it.each(["workitem.transition", "collab.command"])("%s 拒绝非对象 fields，避免把非法数据送入领域服务", async name => {
  const args = name === "workitem.transition" ? { workItemId: mocks.item.id, toStateKey: "DONE", version: 1, fields: "reason" }
    : { resourceType: "WORK_ITEM", resourceId: mocks.item.id, action: "workitem.transition", input: { toStateKey: "DONE", version: 1, fields: "reason" }, userConfirmed: true };
  const result = await (await connect()).callTool({ name, arguments: args });
  expect(body(result).code).toBe("VALIDATION");
  expect(mocks.transition).not.toHaveBeenCalled();
});

it("评论默认读取顶层，指定父评论后读取回复并保留结构化结果", async () => {
  const client = await connect();
  const top = await client.callTool({ name: "workitem.comments", arguments: { workItemId: mocks.item.id } });
  expect(body(top)).toEqual({ comments: [{ id: "top", parentId: null }] });
  const parentId = "22222222-2222-4222-8222-222222222222";
  const reply = await client.callTool({ name: "workitem.comments", arguments: { workItemId: mocks.item.id, parentId } });
  expect(reply.isError, JSON.stringify(body(reply))).not.toBe(true);
  expect(reply.structuredContent).toEqual({ comments: [{ id: "reply", parentId }] });
  expect(mocks.comments).toHaveBeenLastCalledWith(actor, "WORK_ITEM", mocks.item.id, { parentId });
});
