// @vitest-environment node
import { DomainError } from "../src/shared/errors.ts";
import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  session: vi.fn(),
  actor: vi.fn(),
  item: vi.fn(),
  page: vi.fn(),
  plan: vi.fn(),
  token: vi.fn(),
  policy: vi.fn(),
  scoped: vi.fn(),
}));
vi.mock("../src/server/auth/session.ts", () => ({
  verifySession: fake.session,
}));
vi.mock("../src/server/auth/actor-loader.ts", () => ({
  loadActor: fake.actor,
}));
vi.mock("../src/server/services/token.service.ts", () => ({
  authenticateToken: fake.token,
  projectAllowed: (t: { projectWhitelist: string[] }, id: string) =>
    !t.projectWhitelist.length || t.projectWhitelist.includes(id),
  tierAllows: () => true,
}));
vi.mock("../src/server/services/work-item.service.ts", () => ({
  getWorkItem: fake.item,
}));
vi.mock("../src/server/services/wiki.service.ts", () => ({
  getPage: fake.page,
}));
vi.mock("../src/server/services/planning.service.ts", () => ({
  get: fake.plan,
}));
vi.mock("../src/server/services/mcp-client.service.ts", () => ({
  assertToolPolicyAllowed: fake.policy,
}));
vi.mock("../src/server/services/event-access.service.ts", () => ({ canDeliverEvent: fake.scoped, legacyEventScope: vi.fn() }));
import {
  currentEventIdentity,
  eventReadable,
} from "../src/server/services/events-access.ts";
beforeEach(() => {
  vi.resetAllMocks();
  fake.session.mockResolvedValue({ memberId: "a" });
  fake.actor.mockResolvedValue({ memberId: "a", mustChangePassword: false });
  fake.item.mockResolvedValue({ projectId: "p" });
});
it("每次重新验证session，撤销后不沿用旧actor", async () => {
  const credential = { sessionToken: "session", memberId: "a" };
  await expect(currentEventIdentity(credential)).resolves.toMatchObject({
    actor: { memberId: "a" },
  });
  fake.session.mockResolvedValue(null);
  await expect(currentEventIdentity(credential)).rejects.toBeTruthy();
});
it("并发同凭据只共享未完成检查，结束后不缓存旧权限", async () => {
  await Promise.all(
    Array.from({ length: 250 }, () =>
      currentEventIdentity({ sessionToken: "s", memberId: "a" }),
    ),
  );
  expect(fake.actor).toHaveBeenCalledTimes(1);
  await currentEventIdentity({ sessionToken: "s", memberId: "a" });
  expect(fake.actor).toHaveBeenCalledTimes(2);
});
it("广播工作项与评论也必须按当前资源可读权限过滤，未知广播拒绝", async () => {
  const identity = await currentEventIdentity({
    sessionToken: "s",
    memberId: "a",
  });
  const event = {
    id: 1,
    event: "workitem.changed",
    data: { id: "w" },
    memberId: null,
  };
  expect(await eventReadable(identity, event)).toBe(true);
  fake.item.mockRejectedValue(new DomainError("FORBIDDEN", "denied"));
  expect(await eventReadable(identity, event)).toBe(false);
  expect(
    await eventReadable(identity, {
      ...event,
      event: "comment.created",
      data: { targetType: "WORK_ITEM", targetId: "w" },
    }),
  ).toBe(false);
  expect(await eventReadable(identity, { ...event, event: "unknown" })).toBe(
    false,
  );
  expect(
    await eventReadable(identity, {
      ...event,
      event: "notification.new",
      memberId: "b",
    }),
  ).toBe(false);
});
it("同身份同事件并发资源检查只共享inflight，之后撤权不能复用旧结果", async () => {
  const identity = await currentEventIdentity({
    sessionToken: "s",
    memberId: "a",
  });
  const event = {
    id: 1,
    event: "workitem.changed",
    data: { id: "w" },
    memberId: null,
  };
  expect(
    (
      await Promise.all(
        Array.from({ length: 250 }, () => eventReadable(identity, event)),
      )
    ).every(Boolean),
  ).toBe(true);
  expect(fake.item).toHaveBeenCalledTimes(1);
  fake.item.mockRejectedValue(new DomainError("FORBIDDEN", "revoked"));
  expect(await eventReadable(identity, event)).toBe(false);
});

it("普通基础设施Error不能转换成不可见；只有域FORBIDDEN/NOT_FOUND隐藏", async () => {
  const identity = await currentEventIdentity({
    sessionToken: "s",
    memberId: "a",
  });
  const event = {
    id: 1,
    event: "workitem.changed",
    data: { id: "w" },
    memberId: null,
  };
  fake.item.mockRejectedValue(Error("temporary DB failure"));
  await expect(eventReadable(identity, event)).rejects.toThrow(
    "temporary DB failure",
  );
  for (const code of ["FORBIDDEN", "NOT_FOUND"] as const) {
    fake.item.mockRejectedValue(new DomainError(code, "hidden"));
    expect(await eventReadable(identity, event)).toBe(false);
  }
});

it("资源和工作区失效信号沿用当前ACL投递判定", async () => {
  const identity = await currentEventIdentity({ sessionToken: "s", memberId: "a" });
  const event = { id: 1, event: "resource.invalidated", memberId: null, data: { projectId: "p", resourceType: "PAGE", resourceId: "page" } };
  fake.scoped.mockResolvedValue(true);
  expect(await eventReadable(identity, event)).toBe(true);
  fake.scoped.mockResolvedValue(false);
  expect(await eventReadable(identity, event)).toBe(false);
  expect(await eventReadable(identity, { ...event, event: "workspace.invalidated" })).toBe(false);
});
