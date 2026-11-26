/** MCP 与内置助手共享的全部21条业务场景；传输/确认由harness注入。 */
/* eslint-disable @typescript-eslint/no-explicit-any -- 真实业务JSON响应由每个场景断言 */
import assert from "node:assert/strict";
import type { BUSINESS_WORKFLOWS } from "../../src/server/application/capabilities/intelligence-tools.ts";
import { loadActor } from "../../src/server/auth/actor-loader.ts";
import { prepareReadyRelease } from "../../tests/support/release-ready-fixture.ts";
type Json = Record<string, any>;
export type FullBusinessWorkflowId = typeof BUSINESS_WORKFLOWS[number]["id"];
export interface FullBusinessWorkflowHarness {
  call(name: string, args?: Json): Promise<Json>;
  denied(name: string, args: Json, code: string, token?: string): Promise<Json>;
  proof(condition: unknown, label: string): void;
  equal(actual: unknown, expected: unknown, label: string): void;
  adminId: string;
  colleagueId: string;
  memberRoleId: string;
  base: string;
  username: string;
  password: string;
  readOnly: string;
}
export function createFullBusinessWorkflows(harness: FullBusinessWorkflowHarness): Record<FullBusinessWorkflowId, () => Promise<void>> {
  const { call, denied, proof, equal, base, username, password, readOnly } = harness;
  const admin = { id: harness.adminId }, colleague = { id: harness.colleagueId }, memberRole = { id: harness.memberRoleId };
  let projectSequence = 0;
const project = async (name: string) => call("project.create", { key: `MF${++projectSequence}`, name: `MCP 全闭环 ${name}` });
const task = async (projectId: string, title: string, extra: Json = {}) => call("workitem.create", { projectId, type: "TASK", title, ...extra });
const get = async (workItemId: string) => call("workitem.get", { workItemId });
async function update(workItemId: string, patch: Json) { const current = await get(workItemId); return call("workitem.update", { workItemId, expectedVersion: current.workItem.version, ...patch }); }
async function terminal(workItemId: string) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const current = await get(workItemId);
    const metadata = await call("meta.workflow", { projectId: current.workItem.projectId });
    const flow = metadata.workflows.find((f: Json) => f.id === current.workItem.workflowId);
    const states = await call("workflow.states", { workflowId: current.workItem.workflowId });
    const state = states.find((s: Json) => s.id === current.workItem.statusId);
    if (state.category === "TERMINAL") return current;
    const candidates = current.allowedTransitions;
    const edge = candidates.find((t: Json) => flow.states.some((s: Json) => s.key === t.toStateKey && s.category === "TERMINAL" && s.key !== "CANCELLED")) ?? candidates[0];
    proof(edge, "存在可执行迁移边");
    await call("workitem.transition", { workItemId, toStateKey: edge.toStateKey, version: current.workItem.version });
  }
  assert.fail("工作项未到终态");
}
const workflows: Record<FullBusinessWorkflowId, () => Promise<void>> = {
  delivery: async () => {
    const p = await project("交付");
    const context = await call("project.context", { projectId: p.id });
    equal(context.project.id, p.id, "项目上下文关联");
    equal((await call("workitem.list", { projectId: p.id })).items.length, 0, "起始任务列表为空");
    const parent = await task(p.id, "交付父任务");
    const child = await task(p.id, "交付子任务", { parentId: parent.id });
    proof((await call("workitem.children", { workItemId: parent.id })).children.some((r: Json) => r.id === child.id), "子项归属复读");
    await update(parent.id, { title: "已拆解并验收" });
    await call("project.member.add", { projectId: p.id, memberId: colleague.id, roleIds: [memberRole.id] });
    await call("workitem.assign", { workItemId: parent.id, assigneeId: colleague.id });
    const before = await get(parent.id);
    equal(before.workItem.assigneeId, colleague.id, "指派持久化");
    await terminal(parent.id);
    const comment = { workItemId: parent.id, body: "验收通过，已交付", idempotencyKey: "delivery-comment" };
    await call("workitem.comment", comment); await call("workitem.comment", comment);
    const final = await get(parent.id);
    equal(final.workItem.title, "已拆解并验收", "修改标题复读");
    proof(final.workItem.statusId !== before.workItem.statusId, "终态真实改变");
    equal((await call("workitem.comments", { workItemId: parent.id })).comments.filter((c: Json) => c.body === comment.body).length, 1, "幂等评论仅一条");
    await denied("workitem.create", { projectId: p.id, type: "TASK", title: "只读禁止" }, "FORBIDDEN", readOnly);
  },
  planning: async () => {
    const p = await project("计划");
    equal((await call("plan.listIterations", { projectId: p.id })).iterations.length, 0, "起始迭代列表");
    const source = await call("plan.createIteration", { projectId: p.id, name: "原迭代", startDate: "2026-11-01", endDate: "2026-11-14" });
    const target = await call("plan.createIteration", { projectId: p.id, name: "下一迭代", startDate: "2026-11-15", endDate: "2026-11-28" });
    const item = await task(p.id, "待结转任务");
    proof((await call("workitem.list", { projectId: p.id })).items.some((r: Json) => r.id === item.id), "任务发现");
    await update(item.id, { iterationId: source.id });
    equal((await call("plan.getIteration", { iterationId: source.id })).id, source.id, "原迭代详情");
    await call("plan.updateIteration", { iterationId: source.id, name: "已确认原迭代", carryOver: true });
    const completed = await call("plan.completeIteration", { iterationId: source.id, targetIterationId: target.id });
    equal(completed.movedCount, 1, "一项结转");
    const completedAgain = await call("plan.completeIteration", { iterationId: source.id, targetIterationId: target.id });
    equal(completedAgain.completedAt, completed.completedAt, "重复完成保持首次时间");
    equal(completedAgain.movedCount, 0, "重复完成不再次结转");
    const after = await call("plan.getIteration", { iterationId: source.id });
    proof(after.completedAt && after.name === "已确认原迭代", "迭代完成及名称持久化");
    const release = await call("plan.createRelease", { projectId: p.id, name: "交付版本" });
    await update(item.id, { releaseId: release.id });
    await denied("plan.completeRelease", { releaseId: release.id }, "BLOCKED_BY_PREREQUISITE");
    await terminal(item.id);
    await denied("plan.completeRelease", { releaseId: release.id }, "BLOCKED_BY_PREREQUISITE");
    equal((await call("plan.getRelease", { releaseId: release.id })).completedAt, null, "任务终结但缺交付证据时仍不能完成版本");
    // 仅在随机隔离库准备模拟交付证据；完成及复读仍走各自真实传输/确认入口。
    const actor = await loadActor(admin.id);
    assert.ok(actor);
    await prepareReadyRelease(actor, p.id, release.id);
    const released = await call("plan.completeRelease", { releaseId: release.id });
    equal((await call("plan.completeRelease", { releaseId: release.id })).completedAt, released.completedAt, "完成版本保持首次时间");
    proof((await call("plan.getRelease", { releaseId: release.id })).completedAt, "版本完成复读");
    await call("plan.archiveIteration", { iterationId: source.id });
    proof((await call("plan.getIteration", { iterationId: source.id })).archivedAt, "迭代归档复读");
    await call("plan.unarchiveIteration", { iterationId: source.id });
    equal((await call("plan.getIteration", { iterationId: source.id })).archivedAt, null, "迭代恢复复读");
    equal((await get(item.id)).workItem.iterationId, target.id, "任务结转引用持久化");
  },
  ideas: async () => {
    const p = await project("想法");
    const idea = await call("idea.submit", { projectId: p.id, title: "待评审想法" });
    proof((await call("idea.list", { projectId: p.id })).items.some((r: Json) => r.id === idea.id), "想法列表发现");
    equal((await call("idea.get", { ideaId: idea.id })).title, "待评审想法", "想法详情");
    await call("idea.update", { ideaId: idea.id, title: "已评审想法", status: "UNDER_REVIEW" });
    await call("idea.vote", { ideaId: idea.id, weight: 2 });
    const voted = await call("idea.get", { ideaId: idea.id });
    equal(voted.voteCount, 1, "投票人数复读");
    equal(voted.votes.find((v: Json) => v.memberId === admin.id).weight, 2, "投票权重复读");
    const promoted = await call("idea.promote", { ideaId: idea.id, type: "TASK" });
    equal((await call("idea.promote", { ideaId: idea.id, type: "TASK" })).workItem.id, promoted.workItem.id, "转化天然幂等");
    equal((await get(promoted.workItem.id)).workItem.title, "已评审想法", "转化任务标题");
    equal((await call("idea.get", { ideaId: idea.id })).promotedWorkItemId, promoted.workItem.id, "想法回链持久化");
  },
  documentation: async () => {
    const p = await project("文档");
    const page = await call("page.create", { projectId: p.id, title: "历史文档", content: "第一版" });
    proof((await call("page.list", { projectId: p.id })).pages.some((r: Json) => r.id === page.id), "文档列表发现");
    const first = await call("page.get", { pageId: page.id });
    await call("page.update", { pageId: page.id, content: "第二版", expectedRevisionId: first.currentRevisionId });
    const revisions = await call("page.revisions", { projectId: p.id, pageId: page.id });
    equal(revisions.revisions.length, 2, "两次版本保留");
    await call("page.restore", { pageId: page.id, revisionId: first.currentRevisionId, expectedRevisionId: (await call("page.get", { pageId: page.id })).currentRevisionId, idempotencyKey: "restore-full" });
    const restored = await call("page.get", { pageId: page.id });
    equal(restored.content, "第一版", "恢复正文复读");
    proof(restored.currentRevisionId !== first.currentRevisionId, "恢复追加新版本");
    equal((await call("page.revisions", { projectId: p.id, pageId: page.id })).revisions.length, 3, "恢复保留历史");
  },
  automation: async () => {
    const p = await project("自动化");
    const item = await task(p.id, "自动化样本");
    equal((await call("automation.listRules", { projectId: p.id })).rules.length, 0, "无初始规则");
    const rule = await call("automation.createRule", { projectId: p.id, name: "验收自动评论", trigger: "WORK_ITEM_UPDATED", conditions: {}, actions: [{ type: "ADD_COMMENT", body: "自动化初始评论" }], enabled: true });
    equal((await call("automation.testRule", { projectId: p.id, ruleId: rule.id, workItemId: item.id })).matched, true, "预演条件匹配");
    equal((await call("automation.listRuns", { projectId: p.id })).runs.length, 0, "预演不执行动作");
    await call("automation.updateRule", { projectId: p.id, ruleId: rule.id, actions: [{ type: "ADD_COMMENT", body: "自动化真实执行" }] });
    await update(item.id, { title: "触发自动化" });
    let runs = (await call("automation.listRuns", { projectId: p.id })).runs;
    // 业务事件异步提交：以有界真实HTTP复读等待，不能把空数组当成功。
    for (let attempt = 0; attempt < 50 && !runs.some((r: Json) => r.run.ruleId === rule.id && r.run.workItemId === item.id); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      runs = (await call("automation.listRuns", { projectId: p.id })).runs;
    }
    proof(runs.some((r: Json) => r.run.ruleId === rule.id && r.run.workItemId === item.id && r.run.status === "SUCCESS"), "真实执行记录");
    equal((await call("workitem.comments", { workItemId: item.id })).comments.filter((c: Json) => c.body === "自动化真实执行").length, 1, "真实动作持久化");
    await call("automation.updateRule", { projectId: p.id, ruleId: rule.id, enabled: false });
    equal((await call("automation.listRules", { projectId: p.id })).rules[0].enabled, false, "规则停用复读");
  },
  import: async () => {
    const p = await project("导入");
    const batch = await call("import.create", { projectId: p.id, filename: "closure.csv", contentBase64: Buffer.from("标题,优先级\n导入未改,HIGH\n导入已改,MEDIUM\n").toString("base64") });
    proof(await call("import.suggestions", { projectId: p.id, batchId: batch.batchId }), "映射建议真实读取");
    await call("import.setMapping", { projectId: p.id, batchId: batch.batchId, fieldMap: { 标题: "title", 优先级: "priority" }, defaultType: "TASK" });
    await call("import.dryRun", { projectId: p.id, batchId: batch.batchId });
    const preview = await call("import.get", { projectId: p.id, batchId: batch.batchId });
    equal(preview.rows.length, 2, "预演行复读");
    equal(preview.errorCount, 0, "预演无错误");
    await call("import.confirm", { projectId: p.id, batchId: batch.batchId });
    const persisted = (await call("workitem.list", { projectId: p.id })).items;
    equal(persisted.length, 2, "导入后两项可发现");
    const unchanged = persisted.find((r: Json) => r.title === "导入未改");
    const changed = persisted.find((r: Json) => r.title === "导入已改");
    equal((await get(unchanged.id)).workItem.priority, "HIGH", "映射优先级持久化");
    await update(changed.id, { title: "导入后人工修改需保留" });
    const rollback = await call("import.rollback", { projectId: p.id, batchId: batch.batchId });
    equal(rollback.removed, 1, "回滚报告移除一项");
    equal(rollback.retainedModified, 1, "回滚报告保留一项已修改记录");
    equal(rollback.retainedUnknown, 0, "回滚报告无缺失基线");
    equal((await call("import.get", { projectId: p.id, batchId: batch.batchId })).status, "ROLLED_BACK", "回滚状态复读");
    const after = (await call("workitem.list", { projectId: p.id })).items;
    proof(!after.some((r: Json) => r.id === unchanged.id), "未修改导入项回滚移除");
    proof(after.some((r: Json) => r.id === changed.id && r.title === "导入后人工修改需保留"), "回滚保留导入后修改");
  },
  intake: async () => {
    const p = await project("收集");
    const form = (await call("intake.createForm", { projectId: p.id, name: "公开需求收集", schema: [{ key: "title", label: "标题", type: "TEXT", required: true }] })).form;
    proof((await call("intake.listForms", { projectId: p.id })).forms.some((r: Json) => r.id === form.id), "表单可发现");
    // 一次性匿名链接按产品边界由已登录管理 REST 取得；凭据仅来自本次测试账号。
    const login = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
    equal(login.status, 200, "测试管理员登录");
    const session = await login.json() as Json;
    const cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    const rotate = await fetch(`${base}/api/v1/intake-forms/${form.id}/rotate-token`, { method: "POST", headers: { cookie, "x-csrf-token": decodeURIComponent(session.csrfToken) } });
    equal(rotate.status, 200, "管理入口取得匿名链接");
    const link = await rotate.json() as Json;
    const submit = await fetch(`${base}/api/v1/intake/${link.submitToken}/submissions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "外部需求转交付" }) });
    equal(submit.status, 201, "真实匿名提交HTTP");
    const submitted = await submit.json() as Json;
    proof((await call("intake.listSubmissions", { projectId: p.id, status: "PENDING" })).items.some((r: Json) => r.id === submitted.id), "待评审提交发现");
    const converted = await call("intake.convertSubmission", { projectId: p.id, submissionId: submitted.id });
    equal((await call("idea.get", { ideaId: converted.idea.id })).title, "外部需求转交付", "转化想法复读");
    const promoted = await call("idea.promote", { ideaId: converted.idea.id, type: "TASK" });
    equal((await get(promoted.workItem.id)).workItem.title, "外部需求转交付", "收集最终工作项复读");
    equal((await call("idea.get", { ideaId: converted.idea.id })).promotedWorkItemId, promoted.workItem.id, "想法任务关联");
  },
  project: async () => {
    const p = await project("项目");
    proof((await call("member.list", {})).members.some((r: Json) => r.id === colleague.id), "目录发现成员");
    proof((await call("role.list", {})).roles.some((r: Json) => r.id === memberRole.id), "目录发现角色");
    await call("project.member.add", { projectId: p.id, memberId: colleague.id, roleIds: [memberRole.id] });
    proof((await call("project.members", { projectId: p.id })).members.some((r: Json) => r.id === colleague.id), "成员添加复读");
    await call("project.update", { projectId: p.id, name: "项目配置已确认" });
    equal((await call("project.get", { projectId: p.id })).name, "项目配置已确认", "项目更新复读");
    await call("project.archive", { projectId: p.id });
    proof((await call("project.get", { projectId: p.id })).archivedAt, "项目归档复读");
    await call("project.unarchive", { projectId: p.id });
    equal((await call("project.get", { projectId: p.id })).archivedAt, null, "项目恢复复读");
  },
  analysis: async () => {
    const p = await project("分析");
    const it = await call("plan.createIteration", { projectId: p.id, name: "分析迭代", startDate: "2026-11-14", endDate: "2026-11-16" });
    await task(p.id, "统计样本", { iterationId: it.id, estimatePoints: 3 });
    proof((await call("plan.listIterations", { projectId: p.id })).iterations.some((r: Json) => r.id === it.id), "统计迭代发现");
    equal((await call("insight.burnDown", { projectId: p.id, iterationId: it.id })).points.length, 3, "燃尽逐日真实数据");
    equal((await call("insight.cumulativeFlow", { projectId: p.id, iterationId: it.id })).series.length, 3, "累积流逐日真实数据");
    const report = await call("project.report", { projectId: p.id });
    const pdf = Buffer.from(report.contentBase64, "base64");
    equal(pdf.subarray(0, 4).toString(), "%PDF", "真实PDF文件头");
    equal(pdf.length, report.sizeBytes, "PDF长度一致");
    proof(pdf.length > 100 && pdf.length <= 1048576, "报告文件有内容且有界");
  },
  workflow: async () => {
    const p = await project("工作流");
    proof((await call("workflow.list", { projectId: p.id })).workflows.length >= 3, "项目默认工作流发现");
    const flow = await call("workflow.create", { projectId: p.id, name: "可配置审批流程", appliesToType: "TASK" });
    equal((await call("workflow.states", { workflowId: flow.id })).length, 0, "新建状态列表");
    const first = await call("workflow.addState", { projectId: p.id, workflowId: flow.id, key: "QUEUED", name: "排队", category: "NOT_STARTED" });
    const next = await call("workflow.addState", { projectId: p.id, workflowId: flow.id, key: "DOING", name: "处理中", category: "IN_PROGRESS" });
    const edge = await call("workflow.addTransition", { projectId: p.id, workflowId: flow.id, fromStateId: first.id, toStateId: next.id });
    await call("workflow.updateTransition", { projectId: p.id, workflowId: flow.id, transitionId: edge.id, requiresApproval: true, approverRoleKeys: ["ADMIN"] });
    const meta = (await call("meta.workflow", { projectId: p.id })).workflows.find((r: Json) => r.id === flow.id);
    proof(meta.states.some((s: Json) => s.key === first.key) && meta.states.some((s: Json) => s.key === next.key), "meta复读配置状态");
    proof(meta.transitions.some((e: Json) => e.from === first.key && e.to === next.key), "meta复读迁移端点");
    proof((await call("workflow.transitions", { workflowId: flow.id })).some((e: Json) => e.id === edge.id && e.requiresApproval), "审批设置真实复读");
  },
  personal: async () => {
    equal((await call("todo.list", {})).todos.length, 0, "本人初始待办");
    const todo = await call("todo.create", { title: "完成全流程验收", dueDate: "2026-11-16" });
    await call("todo.update", { todoId: todo.id, done: true });
    proof((await call("todo.list", { done: true })).todos.some((r: Json) => r.id === todo.id && r.done), "待办完成复读");
    equal((await call("focus.blocks", {})).length, 0, "初始时间块");
    const block = await call("focus.createBlock", { title: "验收专注", startAt: "2026-11-16T10:00:00Z", endAt: "2026-11-16T11:00:00Z" });
    const session = await call("focus.recordSession", { timeBlockId: block.id, startedAt: "2026-11-16T10:00:00Z", endedAt: "2026-11-16T10:25:00Z", actualMinutes: 25 });
    const today = await call("focus.today", { day: "2026-11-16" });
    proof(today.blocks.some((r: Json) => r.id === block.id) && today.sessions.some((r: Json) => r.id === session.id), "时间安排和会话关联复读");
    equal(today.focusedMinutes, 25, "本人专注分钟统计"); equal(today.plannedMinutes, 60, "本人计划分钟统计");
  },
  dependencies: async () => {
    const p = await project("依赖"); const a = await task(p.id, "上游"); const b = await task(p.id, "下游");
    equal((await get(a.id)).workItem.id, a.id, "依赖端点读取");
    equal((await call("workitem.relations", { workItemId: b.id })).blockedBy.length, 0, "初始无阻塞");
    const relation = await call("workitem.link", { fromWorkItemId: b.id, toWorkItemId: a.id, type: "BLOCKED_BY" });
    proof((await call("workitem.relations", { workItemId: b.id })).blockedBy.some((r: Json) => r.id === relation.id), "依赖复读");
    await denied("workitem.link", { fromWorkItemId: a.id, toWorkItemId: b.id, type: "BLOCKED_BY" }, "VALIDATION");
    await call("workitem.unlink", { workItemId: b.id, relationId: relation.id });
    equal((await call("workitem.relations", { workItemId: b.id })).blockedBy.length, 0, "解除后下游复读");
    equal((await call("workitem.relations", { workItemId: a.id })).blocks.length, 0, "解除后上游复读");
  },
  collaboration: async () => {
    const p = await project("协作"); const item = await task(p.id, "共同交接");
    await call("project.member.add", { projectId: p.id, memberId: colleague.id, roleIds: [memberRole.id] });
    proof((await call("project.members", { projectId: p.id })).members.some((r: Json) => r.id === colleague.id), "交接成员发现");
    await call("workitem.addCollaborator", { projectId: p.id, workItemId: item.id, memberId: colleague.id });
    proof((await call("workitem.collaborators", { workItemId: item.id })).collaborators.some((r: Json) => r.memberId === colleague.id || r.id === colleague.id), "协作者复读");
    const current = await get(item.id);
    await call("workitem.transfer", { projectId: p.id, workItemId: item.id, assigneeId: colleague.id, version: current.workItem.version, reason: "验收交接" });
    proof(JSON.stringify(await call("workitem.transfers", { workItemId: item.id })).includes("验收交接"), "交接原因复读");
    equal((await get(item.id)).workItem.assigneeId, colleague.id, "新负责人复读");
    const time = await call("timeLog.create", { workItemId: item.id, minutes: 45, loggedDate: "2026-11-16", note: "协作验收", idempotencyKey: "full-time" });
    proof((await call("timeLog.list", { workItemId: item.id })).timeLogs.some((r: Json) => r.id === time.id && r.minutes === 45), "工时持久化复读");
  },
  progress: async () => {
    const p = await project("进展"); const item = await task(p.id, "汇报任务");
    const ms = await call("plan.createMilestone", { projectId: p.id, name: "交付里程碑" });
    equal((await get(item.id)).workItem.id, item.id, "进展目标读取");
    const update = await call("workitem.addProgressUpdate", { workItemId: item.id, summary: "完成一半", nextSteps: "继续验收", blockers: "等待审查" });
    proof((await call("workitem.progressUpdates", { workItemId: item.id })).updates.some((r: Json) => r.id === update.id && r.summary === "完成一半" && r.blockers === "等待审查"), "任务进展正文复读");
    const milestone = await call("plan.addMilestoneProgressUpdate", { milestoneId: ms.id, summary: "里程碑推进", nextSteps: "最终验收", blockers: null });
    proof((await call("plan.milestoneDetail", { milestoneId: ms.id })).progressUpdates.some((r: Json) => r.id === milestone.id && r.summary === "里程碑推进"), "里程碑详情复读进展");
  },
  attachments: async () => {
    const p = await project("附件"); const item = await task(p.id, "附件任务");
    const target = { projectId: p.id, targetType: "WORK_ITEM", targetId: item.id };
    equal((await call("attachment.list", target)).attachments.length, 0, "初始附件列表");
    const text = "真实MCP附件字节\nline2";
    const attachment = await call("attachment.upload", { ...target, originalName: "closure.txt", mimeType: "text/plain", dataBase64: Buffer.from(text).toString("base64") });
    proof((await call("attachment.list", target)).attachments.some((r: Json) => r.id === attachment.id), "同附件上传复读");
    const downloaded = await call("attachment.download", { ...target, attachmentId: attachment.id });
    equal(Buffer.from((downloaded.dataBase64 ?? downloaded.contentBase64), "base64").toString(), text, "同附件下载字节一致");
    proof(!JSON.stringify(downloaded).includes("storagePath"), "下载不泄露存储位置");
    await call("attachment.remove", { attachmentId: attachment.id });
    equal((await call("attachment.list", target)).attachments.length, 0, "删除附件复读");
    await denied("attachment.download", { ...target, attachmentId: attachment.id }, "NOT_FOUND");
  },
  fields: async () => {
    const p = await project("字段");
    equal((await call("customField.definitions", { projectId: p.id })).definitions.length, 0, "初始字段目录");
    const field = await call("customField.create", { projectId: p.id, key: "closure_number", name: "验收数值", type: "NUMBER" });
    const item = await task(p.id, "类型化字段任务"); const current = await get(item.id);
    const args = { workItemId: item.id, expectedVersion: current.workItem.version, values: { [field.id]: 42 }, idempotencyKey: "full-field" };
    await call("customField.setValues", args); await call("customField.setValues", args);
    equal((await call("customField.getValues", { workItemId: item.id })).values.find((r: Json) => r.defId === field.id).value, 42, "类型化数值复读");
    const after = await get(item.id);
    await denied("customField.setValues", { workItemId: item.id, expectedVersion: after.workItem.version, values: { [field.id]: "不是数字" } }, "VALIDATION");
    equal((await get(item.id)).workItem.version, after.workItem.version, "类型拒绝不改变版本");
    await denied("customField.setValues", { ...args, idempotencyKey: "full-field-stale" }, "VERSION_CONFLICT");
  },
  views: async () => {
    equal((await call("savedView.list", {})).views.length, 0, "初始个人视图");
    const a = await call("savedView.create", { name: "个人视图A", viewType: "LIST" });
    const b = await call("savedView.create", { name: "个人视图B", viewType: "BOARD" });
    equal((await call("savedView.get", { savedViewId: a.id })).name, "个人视图A", "创建视图复读");
    await call("savedView.update", { savedViewId: a.id, name: "个人视图已调整" });
    await call("savedView.reorder", { ids: [b.id, a.id] });
    equal((await call("savedView.get", { savedViewId: a.id })).name, "个人视图已调整", "调整视图复读");
    equal((await call("savedView.list", {})).views.map((r: Json) => r.id), [b.id, a.id], "排序持久化");
  },
  slaApproval: async () => {
    const p = await project("时限审批");
    equal((await call("sla.listPolicies", { projectId: p.id })).policies.length, 0, "初始SLA策略");
    const policy = await call("sla.createPolicy", { projectId: p.id, name: "30分钟响应", responseMinutes: 30, resolveMinutes: 90 });
    const item = await task(p.id, "带SLA审批任务");
    const sla = (await call("sla.get", { workItemId: item.id })).sla;
    equal(sla.policyId, policy.id, "SLA策略命中同任务");
    proof(sla.responseDueAt && sla.resolveDueAt, "SLA真实时钟");
    const edge = (await call("workflow.transitions", { workflowId: item.workflowId })).find((r: Json) => r.fromStateId === item.statusId);
    const target = (await call("workflow.states", { workflowId: item.workflowId })).find((r: Json) => r.id === edge.toStateId);
    await call("workflow.updateTransition", { projectId: p.id, workflowId: item.workflowId, transitionId: edge.id, requiresApproval: true, approverRoleKeys: ["ADMIN"] });
    await denied("workitem.transition", { workItemId: item.id, toStateKey: target.key, version: item.version }, "BLOCKED_BY_PREREQUISITE");
    equal((await get(item.id)).workItem.statusId, item.statusId, "待审批前保持状态");
    const approval = (await call("approval.list", { workItemId: item.id })).approvals.find((r: Json) => r.status === "PENDING");
    proof(approval, "真实待审记录发现");
    await call("approval.approve", { approvalId: approval.id, comment: "同意交付", idempotencyKey: "full-approve" });
    equal((await get(item.id)).workItem.statusId, target.id, "审批后真实流转复读");
    equal((await call("approval.list", { workItemId: item.id })).approvals[0].status, "APPROVED", "审批终态复读");
  },
  dashboards: async () => {
    const p = await project("仪表盘"); await task(p.id, "统计任务");
    equal((await call("dashboard.list", { projectId: p.id })).dashboards.length, 0, "初始仪表盘");
    const dashboard = await call("dashboard.create", { projectId: p.id, name: "项目统计" });
    const widget = await call("dashboard.widgets.create", { projectId: p.id, dashboardId: dashboard.id, type: "COUNT" });
    equal((await call("dashboard.widgets.data", { projectId: p.id, dashboardId: dashboard.id, widgetId: widget.id })).data.total, 1, "真实工作项数量");
    const detail = await call("dashboard.get", { projectId: p.id, dashboardId: dashboard.id });
    proof(detail.widgets.some((r: Json) => r.id === widget.id && r.type === "COUNT"), "仪表盘配置复读");
  },
  portfolios: async () => {
    const p = await project("组合甲"); const q = await project("组合乙");
    equal((await call("portfolio.list", {})).portfolios.length, 0, "初始组合");
    const portfolio = await call("portfolio.create", { name: "业务组合" });
    await call("portfolio.addProject", { portfolioId: portfolio.id, projectId: p.id });
    await call("portfolio.addProject", { portfolioId: portfolio.id, projectId: q.id });
    const detail = await call("portfolio.get", { portfolioId: portfolio.id });
    equal(detail.projects.map((r: Json) => r.projectId ?? r.id).sort(), [p.id, q.id].sort(), "项目组合关联集合");
    equal((await call("portfolio.summary", { portfolioId: portfolio.id })).totals.projectCount, 2, "组合汇总真实项目数");
  },
  organization: async () => {
    const p = await project("组织角色");
    const dept = await call("organization.createDepartment", { name: "闭环部门" });
    const pos = await call("organization.createPosition", { name: "闭环职位", departmentId: dept.id });
    proof((await call("organization.departments", {})).departments.some((r: Json) => r.id === dept.id), "部门目录发现");
    const positions = await call("organization.positions", {});
    proof((Array.isArray(positions) ? positions : positions.positions).some((r: Json) => r.id === pos.id), "职位目录发现");
    proof((await call("member.list", {})).members.some((r: Json) => r.id === colleague.id), "组织成员发现");
    await call("organization.assignMember", { memberId: colleague.id, departmentId: dept.id, positionId: pos.id });
    await call("member.list", {});
    const assigned = await call("member.get", { memberId: colleague.id });
    equal(assigned.departmentId, dept.id, "成员部门复读"); equal(assigned.positionId, pos.id, "成员职位复读");
    const team = await call("team.create", { name: "闭环团队" });
    proof((await call("team.list", {})).teams.some((r: Json) => r.id === team.id), "团队目录复读");
    proof((await call("role.list", {})).roles.some((r: Json) => r.id === memberRole.id), "可授角色发现");
    const before = await call("role.assignments", { memberId: colleague.id });
    const assignment = await call("role.assign", { memberId: colleague.id, roleId: memberRole.id, scopeType: "PROJECT", scopeId: p.id });
    const after = await call("role.assignments", { memberId: colleague.id });
    equal(after.length, before.length + 1, "新增一条角色范围");
    proof(after.some((r: Json) => r.id === assignment.id && r.roleId === memberRole.id && r.scopeId === p.id && r.scopeType === "PROJECT"), "角色范围精确复读");
  },
};
  return workflows;
}
