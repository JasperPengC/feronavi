import "./_env.ts";
import { confirmedTestArgs } from "./lib/mcp-test-confirmation.ts";
import { ALL_TOOLS } from "../src/server/application/capabilities/tools.ts";
/** 仅在随机临时数据库中执行工作项/计划 MCP HTTP 闭环与权限反控。 */
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import {
  member,
  role,
  roleAssignment,
  projectMembership,
  timeLog,
} from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projects from "../src/server/services/project.service.ts";
import * as tokens from "../src/server/services/token.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";

const [adminRole] = await db.select().from(role).where(eq(role.key, "ADMIN"));
const [memberRole] = await db.select().from(role).where(eq(role.key, "MEMBER"));
const makeMember = async (username: string) =>
  (
    await db
      .insert(member)
      .values({
        username,
        email: `${username}@test.invalid`,
        name: username,
        status: "ACTIVE",
        passwordHash: await hashPassword("mcp-planning-test-12345"),
      })
      .returning()
  )[0]!;
const adminMember = await makeMember("mcp-plan-admin");
const viewer = await makeMember("mcp-plan-viewer");
await db.insert(roleAssignment).values({
  memberId: adminMember.id,
  roleId: adminRole!.id,
  scopeType: "ORG",
  scopeId: null,
});
const admin = (await loadActor(adminMember.id))!;
const project = await projects.createProject(admin, {
  key: "MCPPLAN",
  name: "MCP 计划验收",
});
const outside = await projects.createProject(admin, {
  key: "MCPOTHER",
  name: "白名单外",
});
await db.insert(roleAssignment).values({
  memberId: viewer.id,
  roleId: memberRole!.id,
  scopeType: "PROJECT",
  scopeId: project.id,
});
await db
  .insert(projectMembership)
  .values([
    { projectId: project.id, memberId: admin.memberId, roleId: adminRole!.id },
    { projectId: project.id, memberId: viewer.id, roleId: memberRole!.id },
  ])
  .onConflictDoNothing();
const viewerActor = (await loadActor(viewer.id))!;
const rw = (
  await tokens.createToken(admin, { name: "工作计划读写", tier: "READ_WRITE" })
).token;
const ro = (
  await tokens.createToken(admin, { name: "只读", tier: "READ_ONLY" })
).token;
const scoped = (
  await tokens.createToken(admin, {
    name: "单项目",
    tier: "READ_WRITE",
    projectWhitelist: [project.id],
  })
).token;
const viewerToken = (
  await tokens.createToken(viewerActor, {
    name: "普通成员",
    tier: "READ_WRITE",
  })
).token;
await ensureInitialized();
const app = await buildApp({ logger: false });
let checks = 0;
async function rpc(name: string, args: Record<string, unknown>, token = rw) {
  const tool = ALL_TOOLS.find(tool => tool.name === name);
  // 本套绝大多数资源由同一项目夹具创建；显式范围始终保留用于越界反控。
  const input = tool?.inputSchema.required?.includes("projectId") && !Object.hasOwn(args, "projectId") ? { projectId: project.id, ...args } : args;
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/mcp",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
    },
    payload: {
      jsonrpc: "2.0",
      id: ++checks,
      method: "tools/call",
      params: { name, arguments: confirmedTestArgs(name, input) },
    },
  });
  const body = response.json();
  const data = JSON.parse(
    body.result?.content?.[0]?.text ?? JSON.stringify(body.error ?? {}),
  );
  return { failed: !!body.result?.isError || !!body.error, data };
}
async function call(name: string, args: Record<string, unknown>, token = rw) {
  const result = await rpc(name, args, token);
  assert.equal(result.failed, false, `${name}: ${JSON.stringify(result.data)}`);
  return ALL_TOOLS.find(tool => tool.name === name)?.resultEnvelope || result.data?.replayed !== undefined ? result.data.result : result.data;
}
async function denied(
  name: string,
  args: Record<string, unknown>,
  token: string,
  code: string,
) {
  const result = await rpc(name, args, token);
  assert.equal(result.failed, true, `${name} 应拒绝`);
  assert.equal(result.data.code, code, `${name} 错误码`);
}
try {
  const wi = await call("workitem.create", {
    projectId: project.id,
    type: "TASK",
    title: "转派父任务",
  });
  const child = await call("workitem.create", {
    projectId: project.id,
    type: "TASK",
    title: "子任务",
    parentId: wi.id,
  });
  assert.ok(
    (await call("workitem.children", { workItemId: wi.id })).children.some(
      (r: { id: string }) => r.id === child.id,
    ),
  );
  const current = await call("workitem.get", { workItemId: wi.id });
  const transferArgs = {
    workItemId: wi.id,
    assigneeId: viewer.id,
    reason: "协作接力",
    version: current.workItem.version,
  };
  await call("workitem.transfer", transferArgs);
  await denied("workitem.transfer", transferArgs, rw, "VALIDATION");
  assert.equal((await call("workitem.transfers", { workItemId: wi.id })).length, 1);
  assert.ok(
    JSON.stringify(
      await call("workitem.transfers", { workItemId: wi.id }),
    ).includes("协作接力"),
  );
  await denied(
    "workitem.transfer",
    { ...transferArgs, version: 0 },
    rw,
    "VALIDATION",
  );
  await denied(
    "workitem.transfer",
    { ...transferArgs, assigneeId: null },
    rw,
    "VERSION_CONFLICT",
  );
  const linked = await call("workitem.link", {
    fromWorkItemId: wi.id,
    toWorkItemId: child.id,
    type: "RELATES_TO",
  });
  const relationId = linked.id;
  assert.ok(
    (await call("workitem.relations", { workItemId: wi.id })).others.some(
      (r: { id: string }) => r.id === relationId,
    ),
  );
  const unrelated = await call("workitem.create", {
    projectId: project.id,
    type: "TASK",
    title: "无关任务",
  });
  await denied(
    "workitem.unlink",
    { workItemId: unrelated.id, relationId },
    rw,
    "FORBIDDEN",
  );
  await denied(
    "workitem.unlink",
    { workItemId: wi.id, relationId },
    viewerToken,
    "FORBIDDEN",
  );
  await call("workitem.unlink", { workItemId: wi.id, relationId });
  assert.equal(
    (await call("workitem.relations", { workItemId: wi.id })).others.length,
    0,
  );

  const kinds = ["Milestone", "Iteration", "Release", "Module"] as const;
  const plans: Record<string, string> = {};
  for (const kind of kinds) {
    const args =
      kind === "Iteration"
        ? { startDate: "2026-11-01", endDate: "2026-11-14" }
        : {};
    const row = await call(`plan.create${kind}`, {
      projectId: project.id,
      name: kind,
      ...args,
    });
    const key = `${kind.toLowerCase()}Id`;
    plans[key] = row.id;
    const before = await call(`plan.get${kind}`, { [key]: row.id });
    assert.equal((before.milestone ?? before).id, row.id);
    await call(`plan.update${kind}`, { [key]: row.id, name: `${kind} 已更新` });
    const after = await call(`plan.get${kind}`, { [key]: row.id });
    assert.equal((after.milestone ?? after).name, `${kind} 已更新`);
    await denied(
      `plan.update${kind}`,
      { [key]: row.id, name: "越权" },
      viewerToken,
      "FORBIDDEN",
    );
    await denied(
      `plan.update${kind}`,
      { [key]: row.id, name: "只读" },
      ro,
      "FORBIDDEN",
    );
  }
  assert.ok(
    (await call("plan.listModules", { projectId: project.id })).modules.some(
      (r: { id: string }) => r.id === plans.moduleId,
    ),
  );
  for (const kind of ["Milestone", "Module"]) {
    const key = `${kind.toLowerCase()}Id`;
    await call(`plan.archive${kind}`, { [key]: plans[key] });
    const archived = await call(`plan.get${kind}`, { [key]: plans[key] });
    assert.ok((archived.milestone ?? archived).archivedAt);
    await call(`plan.unarchive${kind}`, { [key]: plans[key] });
    const restored = await call(`plan.get${kind}`, { [key]: plans[key] });
    assert.equal((restored.milestone ?? restored).archivedAt, null);
  }
  await call("plan.setIterationCapacity", {
    iterationId: plans.iterationId,
    memberId: viewer.id,
    capacityPoints: 8,
  });
  assert.equal(
    (
      await call("plan.iterationCapacity", { iterationId: plans.iterationId })
    ).members.find((m: { memberId: string }) => m.memberId === viewer.id)
      .capacityPoints,
    8,
  );
  await denied(
    "plan.setIterationCapacity",
    {
      iterationId: plans.iterationId,
      memberId: viewer.id,
      capacityPoints: 1,
      capacityHours: 1,
    },
    rw,
    "VALIDATION",
  );
  await denied(
    "plan.setIterationCapacity",
    { iterationId: plans.iterationId, memberId: viewer.id, capacityHours: 4 },
    viewerToken,
    "FORBIDDEN",
  );
  const foreignModule = await call("plan.createModule", {
    projectId: outside.id,
    name: "项目外模块",
  });
  await denied(
    "plan.updateModule",
    { moduleId: plans.moduleId, parentId: foreignModule.id },
    rw,
    "VALIDATION",
  );
  await denied(
    "plan.getModule",
    { moduleId: foreignModule.id },
    scoped,
    "NOT_FOUND",
  );

  for (const target of ["workitem", "milestone"] as const) {
    const isWorkItem = target === "workitem";
    const parent = isWorkItem
      ? { workItemId: wi.id }
      : { milestoneId: plans.milestoneId };
    const add = isWorkItem
      ? "workitem.addProgressUpdate"
      : "plan.addMilestoneProgressUpdate";
    const list = isWorkItem
      ? "workitem.progressUpdates"
      : "plan.milestoneProgressUpdates";
    const remove = isWorkItem
      ? "workitem.deleteProgressUpdate"
      : "plan.deleteMilestoneProgressUpdate";
    const update = await call(add, {
      ...parent,
      summary: "计划推进",
      nextSteps: "验收",
      blockers: null,
      idempotencyKey: target,
    });
    assert.equal(
      (
        await rpc(add, {
          ...parent,
          summary: "计划推进",
          nextSteps: "验收",
          blockers: null,
          idempotencyKey: target,
        })
      ).data.replayed,
      true,
    );
    assert.ok(
      (await call(list, parent)).updates.some(
        (r: { id: string }) => r.id === update.id,
      ),
    );
    await call(remove, {
      ...parent,
      [isWorkItem ? "workItemProgressUpdateId" : "milestoneProgressUpdateId"]:
        update.id,
    });
    assert.equal((await call(list, parent)).updates.length, 0);
  }
  assert.equal(
    (await call("plan.milestoneDetail", { milestoneId: plans.milestoneId }))
      .milestone.id,
    plans.milestoneId,
  );
  const view1 = await call("savedView.create", {
    name: "个人视图 1",
    viewType: "LIST",
  });
  const view2 = await call("savedView.create", {
    name: "个人视图 2",
    viewType: "BOARD",
  });
  assert.equal(
    (await call("savedView.get", { savedViewId: view1.id }, rw)).id,
    view1.id,
  );
  await denied("savedView.get", { savedViewId: view1.id }, scoped, "FORBIDDEN");
  await denied(
    "savedView.get",
    { savedViewId: view1.id },
    viewerToken,
    "FORBIDDEN",
  );
  await denied(
    "savedView.delete",
    { savedViewId: view1.id },
    viewerToken,
    "FORBIDDEN",
  );
  await call(
    "savedView.reorder",
    { ids: [view2.id, view1.id] },
    rw,
  );
  await denied("savedView.reorder", { ids: [view2.id, view1.id] }, scoped, "FORBIDDEN");
  const personal = (await call("savedView.list", {})).views;
  assert.equal(personal[0].id, view2.id);
  await denied(
    "savedView.reorder",
    { ids: [view1.id, view1.id] },
    rw,
    "VALIDATION",
  );
  const shared = await call("savedView.create", {
    name: "外部共享视图",
    viewType: "LIST",
    scope: "PROJECT_SHARED",
    projectId: outside.id,
  });
  await denied(
    "savedView.get",
    { savedViewId: shared.id },
    scoped,
    "NOT_FOUND",
  );
  await denied(
    "savedView.reorder",
    { projectId: outside.id, ids: [shared.id] },
    scoped,
    "NOT_FOUND",
  );
  await call("savedView.delete", { savedViewId: view1.id });
  await denied("savedView.get", { savedViewId: view1.id }, rw, "NOT_FOUND");
  await denied(
    "workitem.delete",
    { workItemId: unrelated.id },
    ro,
    "FORBIDDEN",
  );
  await call("workitem.delete", { workItemId: unrelated.id });
  await denied("workitem.get", { workItemId: unrelated.id }, rw, "FORBIDDEN");
  // 协作身份、关注、工时与内容引用独立闭环。
  await denied(
    "workitem.addCollaborator",
    { workItemId: child.id, memberId: viewer.id },
    viewerToken,
    "FORBIDDEN",
  );
  await call("workitem.addCollaborator", {
    workItemId: child.id,
    memberId: viewer.id,
  });
  await call("workitem.addCollaborator", {
    workItemId: child.id,
    memberId: viewer.id,
  });
  assert.equal(
    (
      await call("workitem.collaborators", { workItemId: child.id })
    ).collaborators.filter(
      (c: { memberId: string }) => c.memberId === viewer.id,
    ).length,
    1,
  );
  await call(
    "workitem.removeCollaborator",
    { workItemId: child.id, memberId: viewer.id },
    viewerToken,
  );
  assert.equal(
    (await call("workitem.collaborators", { workItemId: child.id }))
      .collaborators.length,
    0,
  );
  await call(
    "workitem.follow",
    { workItemId: child.id, channels: ["IN_APP", "EMAIL"] },
    viewerToken,
  );
  await call(
    "workitem.follow",
    { workItemId: child.id, channels: ["IN_APP", "EMAIL"] },
    viewerToken,
  );
  const watchers = (await call("workitem.watchers", { workItemId: child.id }))
    .watchers;
  assert.equal(
    watchers.find((w: { memberId: string }) => w.memberId === viewer.id)
      .channels.length,
    2,
  );
  await denied("workitem.follow", { workItemId: child.id }, ro, "FORBIDDEN");
  await call("workitem.unfollow", { workItemId: child.id }, viewerToken);
  assert.equal(
    (await call("workitem.watchers", { workItemId: child.id })).watchers.some(
      (w: { memberId: string }) => w.memberId === viewer.id,
    ),
    false,
  );

  const timeInput = {
    workItemId: child.id,
    minutes: 30,
    loggedDate: "2026-11-15",
    note: "协作验收",
    idempotencyKey: "time-once",
  };
  const ownTime = await call("timeLog.create", timeInput, viewerToken);
  assert.equal(
    (await call("timeLog.create", timeInput, viewerToken)).id,
    ownTime.id,
  );
  assert.equal(
    (await call("timeLog.list", { workItemId: child.id })).timeLogs.length,
    1,
  );
  await call(
    "timeLog.update",
    { timeLogId: ownTime.id, minutes: 45 },
    viewerToken,
  );
  assert.equal(
    (await call("timeLog.list", { workItemId: child.id })).timeLogs[0].minutes,
    45,
  );
  const adminTime = await call("timeLog.create", {
    ...timeInput,
    idempotencyKey: "time-admin",
  });
  await denied(
    "timeLog.update",
    { timeLogId: adminTime.id, minutes: 60 },
    viewerToken,
    "FORBIDDEN",
  );
  await denied(
    "timeLog.delete",
    { timeLogId: adminTime.id },
    viewerToken,
    "FORBIDDEN",
  );
  await denied("timeLog.update", { timeLogId: adminTime.id }, rw, "VALIDATION");
  await call("timeLog.delete", { timeLogId: ownTime.id }, viewerToken);
  await call("timeLog.delete", { timeLogId: adminTime.id });
  assert.equal(
    (await call("timeLog.list", { workItemId: child.id })).timeLogs.length,
    0,
  );
  const foreignWork = await call("workitem.create", {
    projectId: outside.id,
    type: "TASK",
    title: "外部工时任务",
  });
  const foreignTime = await call("timeLog.create", {
    workItemId: foreignWork.id,
    minutes: 15,
    loggedDate: "2026-11-15",
  });
  await denied(
    "timeLog.update",
    { timeLogId: foreignTime.id, minutes: 20 },
    scoped,
    "NOT_FOUND",
  );

  const contentArgs = {
    workItemId: child.id,
    targetType: "MILESTONE",
    targetId: plans.milestoneId,
    idempotencyKey: "content-link-once",
  };
  const content = await call("workitem.createContentLink", contentArgs);
  assert.equal(
    (await call("workitem.createContentLink", contentArgs)).id,
    content.id,
  );
  assert.ok(
    (await call("workitem.contentLinks", { workItemId: child.id })).links.some(
      (link: { id: string }) => link.id === content.id,
    ),
  );
  await denied(
    "workitem.deleteContentLink",
    { contentLinkId: content.id },
    viewerToken,
    "FORBIDDEN",
  );
  await denied(
    "workitem.createContentLink",
    { workItemId: child.id, targetType: "WORK_ITEM", targetId: foreignWork.id },
    rw,
    "VALIDATION",
  );
  await denied(
    "workitem.createContentLink",
    { workItemId: child.id, targetType: "WORK_ITEM", targetId: foreignWork.id },
    scoped,
    "VALIDATION",
  );
  await call("workitem.deleteContentLink", { contentLinkId: content.id });
  assert.equal(
    (await call("workitem.contentLinks", { workItemId: child.id })).links
      .length,
    0,
  );
  assert.equal((await call("prefs.get", {}, scoped)).theme, (await call("prefs.get", {})).theme);
  await call(
    "prefs.update",
    {
      theme: "dark",
      density: "compact",
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
    },
    rw,
  );
  const prefs = await call("prefs.get", {}, rw);
  assert.equal(prefs.theme, "dark");
  assert.equal(prefs.density, "compact");
  assert.notEqual((await call("prefs.get", {}, viewerToken)).theme, "dark");
  await denied("prefs.update", { theme: "light" }, ro, "FORBIDDEN");
  // 幂等结果不能绕过当前授权：所有权、可见性与权限撤销后必须再次拒绝。
  const replayTime = await call(
    "timeLog.create",
    { workItemId: child.id, minutes: 5, loggedDate: "2026-11-15" },
    viewerToken,
  );
  const replayUpdate = {
    timeLogId: replayTime.id,
    minutes: 10,
    idempotencyKey: "time-owner-revocation",
  };
  await call("timeLog.update", replayUpdate, viewerToken);
  await db
    .update(timeLog)
    .set({ memberId: admin.memberId })
    .where(eq(timeLog.id, replayTime.id));
  await denied("timeLog.update", replayUpdate, viewerToken, "FORBIDDEN");

  const viewerWork = await call(
    "workitem.create",
    { projectId: project.id, type: "TASK", title: "撤权缓存测试" },
    viewerToken,
  );
  const cachedCollaborator = {
    workItemId: viewerWork.id,
    memberId: admin.memberId,
  };
  const cachedContent = {
    workItemId: viewerWork.id,
    targetType: "MILESTONE",
    targetId: plans.milestoneId,
    idempotencyKey: "content-permission-revocation",
  };
  const cachedPlanUpdate = {
    moduleId: plans.moduleId,
    name: "撤权前模块更新",
  };
  await call("plan.updateModule", cachedPlanUpdate);
  await call("workitem.addCollaborator", cachedCollaborator);
  await call("workitem.createContentLink", cachedContent);
  const cachedPlanCreates = ["Milestone", "Iteration", "Release", "Module"].map(
    (kind) => ({
      kind,
      input: {
        projectId: project.id,
        name: `撤权前 ${kind}`,
        ...(kind === "Iteration"
          ? { startDate: "2026-11-01", endDate: "2026-11-14" }
          : {}),
        idempotencyKey: `create-plan-revocation-${kind}`,
      },
    }),
  );
  for (const entry of cachedPlanCreates)
    await call(`plan.create${entry.kind}`, entry.input);
  await db
    .delete(roleAssignment)
    .where(
      and(
        eq(roleAssignment.memberId, admin.memberId),
        eq(roleAssignment.roleId, adminRole!.id),
      ),
    );
  await denied("plan.updateModule", cachedPlanUpdate, rw, "FORBIDDEN");
  for (const entry of cachedPlanCreates)
    await denied(`plan.create${entry.kind}`, entry.input, rw, "FORBIDDEN");
  await denied("workitem.addCollaborator", cachedCollaborator, rw, "FORBIDDEN");
  await denied("workitem.createContentLink", cachedContent, rw, "FORBIDDEN");
  await db.insert(roleAssignment).values({
    memberId: admin.memberId,
    roleId: adminRole!.id,
    scopeType: "ORG",
    scopeId: null,
  });

  const hiddenWork = await call("workitem.create", {
    projectId: project.id,
    type: "TASK",
    title: "失去可见性",
  });
  const cachedFollow = {
    workItemId: hiddenWork.id,
  };
  await call("workitem.follow", cachedFollow, viewerToken);
  await call("workitem.delete", { workItemId: hiddenWork.id });
  await denied("workitem.follow", cachedFollow, viewerToken, "FORBIDDEN");

  const cachedTimeCreate = {
    workItemId: child.id,
    minutes: 5,
    loggedDate: "2026-11-15",
    idempotencyKey: "time-visibility-revocation",
  };
  await call("timeLog.create", cachedTimeCreate, viewerToken);
  const cachedSharedView = {
    name: "撤权前项目共享视图",
    viewType: "LIST",
    scope: "PROJECT_SHARED",
    projectId: project.id,
  };
  const cachedPersonalView = {
    name: "撤权后本人视图",
    viewType: "LIST",
    scope: "PERSONAL",
  };
  await call("savedView.create", cachedSharedView, viewerToken);
  const personalBeforeRevocation = await call(
    "savedView.create",
    cachedPersonalView,
    viewerToken,
  );
  await db.delete(roleAssignment).where(eq(roleAssignment.memberId, viewer.id));
  await db
    .delete(projectMembership)
    .where(eq(projectMembership.memberId, viewer.id));
  await denied("timeLog.create", cachedTimeCreate, viewerToken, "FORBIDDEN");
  await denied("savedView.create", cachedSharedView, viewerToken, "FORBIDDEN");
  const personalAfterRevocation = await call(
    "savedView.get",
    { savedViewId: personalBeforeRevocation.id },
    viewerToken,
  );
  assert.equal(personalAfterRevocation.id, personalBeforeRevocation.id);
  assert.equal(
    (
      await call(
        "savedView.get",
        { savedViewId: personalAfterRevocation.id },
        viewerToken,
      )
    ).ownerId,
    viewer.id,
  );

  console.log(`工作项/计划/协作 MCP HTTP 闭环通过（${checks} 次调用）`);
} finally {
  await app.close();
  await sql.end({ timeout: 5 });
}
