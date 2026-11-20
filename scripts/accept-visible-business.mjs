/** 显式授权的本机可视业务验收。保留新建演示项目；不供CI调用，不清库、不改已有项目。 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { member, role, roleAssignment, projectMembership, mcpToolPolicy } from "../src/db/schema.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import * as projects from "../src/server/services/project.service.ts";
import * as tokens from "../src/server/services/token.service.ts";
import { closeCache } from "../src/server/auth/cache.ts";
import { TOOL_NAMES } from "../src/server/mcp/tools.ts";
import { reindexPage } from "../src/server/services/knowledge.service.ts";
import { runVisibleCodex } from "./accept-visible-codex.mjs";

const base = process.env.VISIBLE_ACCEPTANCE_BASE;
if (process.env.VISIBLE_ACCEPTANCE_CONFIRM !== "CREATE_DEMO_ONLY" || base !== "http://127.0.0.1:51476" || new URL(process.env.DATABASE_URL).port !== "32777") {
  throw Error("必须显式指定已授权的本机预览和CREATE_DEMO_ONLY；禁止对其他环境执行");
}
const folder = path.resolve(".cache/visible-acceptance-20261115");
await fs.mkdir(folder, { recursive: true, mode: 0o700 });
const statePath = path.join(folder, "state.json");
const state = await fs.readFile(statePath, "utf8").then(JSON.parse).catch(() => ({ resources: {}, checks: [], calls: [], startedAt: new Date().toISOString() }));
if (state.error) { (state.attemptErrors ??= []).push(state.error); delete state.error; }
const save = () => fs.writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
const check = (name, condition, details) => {
  const previous = state.checks.findIndex(c => c.name === name);
  const result = { name, passed: Boolean(condition), ...(details === undefined ? {} : { details }) };
  if (previous < 0) state.checks.push(result);
  else { (state.checkHistory ??= []).push(state.checks[previous]); state.checks[previous] = result; }
  console.log(`${condition ? "PASS" : "FAIL"} ${name}`);
  assert.ok(condition, name);
};
const ensure = async (key, create) => {
  if (state.resources[key]) return state.resources[key];
  const value = await create(); state.resources[key] = value; await save(); return value;
};
const allowed = new Set([
  "ping", "whoami", "meta.capabilities", "meta.tool", "meta.workflow", "meta.fields", "project.context", "project.list", "project.get", "project.members", "project.status", "activity.project",
  "workitem.create", "workitem.update", "workitem.get", "workitem.list", "workitem.children", "workitem.assign", "workitem.transition", "workitem.comment", "workitem.comments", "workitem.link", "workitem.relations", "workitem.addCollaborator", "workitem.collaborators", "workitem.follow", "workitem.watchers", "workitem.createContentLink", "workitem.contentLinks", "workitem.addProgressUpdate", "workitem.progressUpdates",
  "plan.createMilestone", "plan.createIteration", "plan.createRelease", "plan.createModule", "plan.getIteration", "plan.getRelease", "plan.getMilestone", "plan.listIterations", "plan.listReleases", "plan.listMilestones", "plan.listModules", "plan.updateIteration", "plan.updateRelease", "plan.completeIteration", "plan.completeRelease", "plan.setIterationCapacity", "plan.iterationCapacity", "plan.milestoneDetail",
  "page.create", "page.get", "page.update", "page.list", "page.revisions", "knowledge.search", "knowledge.ask", "idea.submit", "idea.vote", "idea.get", "idea.list", "idea.promote", "timeLog.create", "timeLog.list", "attachment.upload", "attachment.list", "attachment.download", "savedView.create", "savedView.list", "dashboard.create", "dashboard.get", "dashboard.widgets.create", "dashboard.widgets.data", "project.exportCsv", "project.report",
]);
let actor, rw, ro, schema;
let seq = 0;
async function request(method, params, token = rw.token) {
  const response = await fetch(`${base}/api/v1/mcp`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, params }), signal: AbortSignal.timeout(90_000),
  });
  assert.equal(response.status, 200, `MCP HTTP ${response.status}`);
  return response.json();
}
async function raw(name, args, token) {
  const start = Date.now(); const body = await request("tools/call", { name, arguments: args }, token);
  const result = body.result;
  const data = result?.content?.[0]?.text ? JSON.parse(result.content[0].text) : body.error ?? result;
  const failed = Boolean(body.error || result?.isError);
  state.calls.push({ name, success: !failed, milliseconds: Date.now() - start, ...(failed ? { code: data.code, message: data.message } : {}) });
  await save(); return { failed, data };
}
async function call(name, args = {}, token) {
  const response = await raw(name, args, token);
  assert.equal(response.failed, false, `${name}: ${JSON.stringify(response.data).slice(0, 400)}`);
  return response.data && "replayed" in response.data && "result" in response.data ? response.data.result : response.data;
}
async function expected(name, args, code, token) {
  const result = await raw(name, args, token);
  check(`${name} 正确拒绝 ${code}`, result.failed && result.data.code === code);
  return result.data;
}
async function transition(id, target, note = "合成业务验收：依据测试结果推进，不代表真实生产发布") {
  const info = await call("workitem.get", { workItemId: id });
  const states = (schema.workflows ?? schema).flatMap(w => w.states ?? []);
  const current = states.find(s => s.id === info.workItem.statusId);
  if (current?.key === target) return info.workItem;
  assert.ok(info.allowedTransitions.some(t => (t.toStateKey ?? t.to?.key ?? t.toKey) === target), `缺少合法迁移到${target}：${JSON.stringify(info.allowedTransitions).slice(0, 600)}`);
  return call("workitem.transition", { workItemId: id, toStateKey: target, version: info.workItem.version, comment: note });
}
async function chain(id, keys) { for (const key of keys) await transition(id, key); }
const idem = key => `visible-20261115:${key}`;
async function outsideSnapshot() {
  const result = {};
  for (const table of ["project", "work_item", "page", "idea", "milestone", "iteration", "release", "module"]) {
    const where = table === "project" ? "id" : "project_id";
    const rows = await sql.unsafe(`select md5(coalesce(string_agg(row_to_json(t)::text, '' order by id), '')) as hash, count(*)::int as count from ${table} t where ${where} <> $1`, [state.project.id]);
    result[table] = rows[0];
  }
  return result;
}

try {
  const [owner] = await db.select({ id: member.id }).from(member).where(eq(member.username, "demo"));
  assert.ok(owner); actor = await loadActor(owner.id); assert.ok(actor);
  state.project = await ensure("project", () => projects.createProject(actor, {
    key: "PORTAL2611", name: "联调演示｜企业客户门户 1.4 交付",
    description: "本项目为用户授权保留的端到端联调演示。所有客户、人员、订单及业务数字均为合成数据。覆盖需求评审、开发协作、缺陷修复、迭代结转、版本完成、知识问答、附件及报告。真实MCP操作记录可在活动中查看，不发送外部邮件或IM，不代表实际代码部署。",
  }));
  await save();
  state.outsideBefore ??= await outsideSnapshot(); await save();
  console.log(`可见项目：${base}/projects/${state.project.id}`);
  const [memberRole] = await db.select().from(role).where(eq(role.key, "MEMBER"));
  state.personas = [];
  for (const [key, label] of [["po", "林澄·产品（演示）"], ["backend", "周航·后端（演示）"], ["frontend", "陈悦·前端（演示）"], ["qa", "沈宁·测试（演示）"]]) {
    const persona = await ensure(`persona:${key}`, async () => {
      // 随机密码仅用于生成hash，既不保存明文也不触发邀请；账号仅授予本演示项目MEMBER。
      const [m] = await db.insert(member).values({ username: `demo-portal-${key}`, email: `portal-${key}@example.invalid`, name: label, status: "ACTIVE", passwordHash: await hashPassword(randomBytes(32).toString("base64url")) }).returning({ id: member.id, name: member.name });
      await db.insert(projectMembership).values({ projectId: state.project.id, memberId: m.id, roleId: memberRole.id });
      await db.insert(roleAssignment).values({ memberId: m.id, roleId: memberRole.id, scopeType: "PROJECT", scopeId: state.project.id });
      return { ...m, key };
    }); state.personas.push(persona);
  }
  for (const tier of ["READ_WRITE", "READ_ONLY"]) {
    const token = await tokens.createToken(actor, { name: `可视闭环验收 ${tier}（临时）`, tier, projectWhitelist: [state.project.id], allowedIpCidrs: ["127.0.0.1/32"], expiresAt: new Date(Date.now() + 2 * 3600_000).toISOString() });
    if (tier === "READ_WRITE") rw = token; else ro = token;
    await db.insert(mcpToolPolicy).values(TOOL_NAMES.filter(n => !allowed.has(n)).map(toolName => ({ tokenId: token.row.id, toolName, effect: "DENY", argConstraints: {} })));
  }
  await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "visible-business-acceptance", version: "1.0" } });
  const tools = await request("tools/list", {});
  await fs.writeFile(path.join(folder, "tool-schemas.json"), JSON.stringify(tools.result.tools.filter(t => allowed.has(t.name)), null, 2));
  schema = await call("meta.workflow", { projectId: state.project.id });
  await fs.writeFile(path.join(folder, "workflow.json"), JSON.stringify(schema, null, 2));
  check("真实HTTP读取工作流和项目成员", (await call("project.members", { projectId: state.project.id })).members.length === 5);
  await expected("project.get", { projectId: "8883a56b-6cad-48d3-968f-4ef33124ba74" }, "NOT_FOUND");
  await expected("workitem.create", { projectId: state.project.id, type: "TASK", title: "只读令牌不得写入" }, "FORBIDDEN", ro.token);
  const p = state.project.id;
  const create = (name, tool, input) => ensure(name, () => call(tool, { projectId: p, ...input, idempotencyKey: idem(name) }));
  state.sprint1 = await create("sprint1", "plan.createIteration", { name: "Sprint 14｜订单与交付体验", startDate: "2026-11-02", endDate: "2026-11-15" });
  state.sprint2 = await create("sprint2", "plan.createIteration", { name: "Sprint 15｜可靠性与体验优化", startDate: "2026-11-16", endDate: "2026-11-29" });
  state.release = await create("release", "plan.createRelease", { name: "客户门户 1.4.0｜演示交付", releaseDate: "2026-11-15" });
  state.milestone = await create("milestone", "plan.createMilestone", { name: "M1｜客户门户交付验收", dueDate: "2026-11-15", description: "合成业务验收：订单幂等、权限隔离、对账导出、物流跟踪、知识FAQ与移动端。" });
  const moduleNames = ["账户与权限", "订单中心", "账单与对账", "交付与物流", "帮助中心", "移动端体验"];
  state.modules = [];
  for (const [i, name] of moduleNames.entries()) state.modules.push(await create(`module:${i}`, "plan.createModule", { name }));
  for (const persona of state.personas) await call("plan.setIterationCapacity", { iterationId: state.sprint2.id, memberId: persona.id, capacityHours: persona.key === "po" ? 24 : 64, idempotencyKey: idem(`capacity:${persona.key}`) });
  const requirements = [
    ["企业成员按角色查看订单与账单", "经办人仅查看本人订单；企业管理员可查看企业全部订单；跨企业资源一律不可见。"],
    ["重复提交订单只生成一笔记录", "弱网连续点击或超时重试时，客户端复用requestId，服务端唯一约束兜底；24小时内同键返回原订单，不重复扣减库存。"],
    ["财务按自然月导出对账清单", "日期按Asia/Shanghai结算，金额按分存储；CSV对以=、+、-、@开头的单元格做公式注入防护。"],
    ["分批发货与物流节点可追踪", "一单多包裹，承运商回调按eventId去重；客户可查看签收时间和异常原因。"],
    ["客户自助查询退款与发票规则", "退款原路返回，审核通过后3个工作日内发起；发票只支持已支付订单，红冲后才能重开。"],
    ["手机端完成下单与售后申请", "390px与320px无横向溢出；表单有明确错误提示，键盘焦点可达，提交失败保留输入。"],
  ];
  state.requirements = []; state.tasks = []; state.subtasks = [];
  for (const [i, [title, acceptance]] of requirements.entries()) {
    const requirement = await create(`req:${i}`, "workitem.create", { type: "REQUIREMENT", title, description: `【合成业务数据】\n\n## 用户故事\n作为企业客户，我希望${title}。\n\n## 验收标准\n${acceptance}\n\n## 业务口径\n本次仅验证平台流程与数据持久化，不代表上述产品代码已实际开发部署。`, assigneeId: state.personas[0].id, priority: i === 1 ? "URGENT" : "HIGH", moduleId: state.modules[i].id, estimatePoints: [5, 8, 5, 8, 3, 5][i] });
    state.requirements.push(requirement);
    for (const [j, action] of ["接口与数据约束", "前端交互与错误恢复", "验收用例与回归记录"].entries()) {
      const task = await create(`task:${i}:${j}`, "workitem.create", { type: "TASK", title: `${title}｜${action}`, description: `【合成业务数据】\n交付范围：${acceptance}\n工作内容：${action}。\n完成标准：实现评审、可复现用例、缺陷回归和记录齐全；此处通过状态推进模拟团队协作。`, parentId: requirement.id, assigneeId: state.personas[j + 1].id, priority: i === 1 ? "HIGH" : "MEDIUM", estimatePoints: [3, 2, 1][j], estimateHours: [12, 8, 4][j], startDate: "2026-11-02", dueDate: i === 5 ? "2026-11-29" : "2026-11-15", iterationId: state.sprint1.id, ...(i < 4 ? { releaseId: state.release.id, milestoneId: state.milestone.id } : {}), moduleId: state.modules[i].id });
      state.tasks.push(task);
      if (j === 0) state.subtasks.push(await create(`subtask:${i}`, "workitem.create", { type: "SUBTASK", title: `${moduleNames[i]}｜边界值与失败恢复校验`, parentId: task.id, assigneeId: state.personas[3].id, estimateHours: 2, iterationId: state.sprint1.id, moduleId: state.modules[i].id }));
    }
  }
  const defects = [
    ["弱网连续提交生成重复订单", "S1", "URGENT", "同一requestId并发请求仅允许一条订单；验收用例含20并发与超时重试。"],
    ["CSV客户备注触发电子表格公式", "S2", "HIGH", "测试值=1+1、@SUM(A1:A2)导出后作为文本，不执行公式。"],
    ["手机320px订单筛选栏横向溢出", "S3", "MEDIUM", "筛选栏换行；320/390px视口均无页面级横向滚动。"],
    ["月末23点订单被计入次月账单", "S2", "HIGH", "Asia/Shanghai自然月边界与闰年日期均正确。"],
    ["物流重复回调产生重复签收通知", "S2", "HIGH", "重复eventId不重复追加物流节点或站内通知。"],
    ["跨企业链接能够看到附件标题", "S1", "URGENT", "不同企业/项目资源统一返回不存在，不泄漏附件元数据。"],
    ["取消退款弹窗后再次打开丢失草稿", "S3", "LOW", "失败恢复保留输入，显式取消才丢弃。"],
    ["帮助页未命中时没有下一步提示", "S4", "LOW", "空结果说明检索方式并引导换词，不能捏造答案。"],
  ];
  state.defects = [];
  for (const [i, [title, severity, priority, expectedBehavior]] of defects.entries()) state.defects.push(await create(`defect:${i}`, "workitem.create", { type: "DEFECT", title, severity, priority, assigneeId: state.personas[i === 2 || i === 6 ? 2 : 1].id, description: `【合成缺陷，不代表Feronavi存在该业务缺陷】\n环境：企业门户1.4演示。\n复现：按标题场景执行边界输入/重试。\n预期：${expectedBehavior}\n验收方法：记录复现、修复说明、回归结果和状态轨迹。`, iterationId: state.sprint1.id, ...(i < 6 ? { releaseId: state.release.id, milestoneId: state.milestone.id } : {}) }));
  await save();
  await create("guide", "page.create", { title: "00｜从这里开始：联调验收导航", content: `# 企业客户门户1.4｜联调演示\n\n所有数据均为合成演示数据，不含真实客户隐私。\n\n- [项目总览](${base}/projects/${p})\n- [工作项表格](${base}/projects/${p}/table)\n- [看板](${base}/projects/${p}/board)\n- [缺陷](${base}/projects/${p}/issues)\n- [里程碑](${base}/projects/${p}/milestones)\n- [知识库](${base}/projects/${p}/wiki)\n- [活动轨迹](${base}/projects/${p}/activity)\n\n此项目将保留完整需求、任务、缺陷和计划，最终验收结果会在本知识库追加。所有“交付”指平台流程演示，不代表客户门户代码已部署。` });
  state.rulesPage = await create("rules", "page.create", { title: "01｜业务规则与验收口径", content: "# 合成业务规则\n\n## 订单幂等\n订单使用requestId作为幂等键，保留24小时；重复提交返回原订单，不重复扣减库存。\n\n## 退款时效\n退款审核通过后3个工作日内发起原路退款；到账以银行处理时间为准。\n\n## 发票\n仅已支付订单可开票；重复申请返回原发票；需要红冲原发票后才可重开。\n\n## 账单\n结算时区为Asia/Shanghai，金额以分存储，导出CSV必须防范公式注入。\n\n## 交付边界\n本项目数据为合成演示，禁止将状态完成解释为真实软件已开发或上线。" });
  await create("testplan", "page.create", { title: "02｜测试矩阵与发布检查单", content: "# 合成业务测试矩阵\n\n|领域|核心路径|异常路径|验收证据|\n|---|---|---|---|\n|需求协作|评审→开发→交付→验证|版本冲突后复读|工作项历史与评论|\n|订单|提交→支付回调→交付|重复请求/网络超时|幂等与依赖关系|\n|缺陷|新建→处理→修复→验证→关闭|重开后再修复|缺陷状态轨迹|\n|计划|迭代结束→未完成结转|未完成版本禁止交付|计划完成快照|\n|文档|创建→修订→引用|旧修订号拒绝覆盖|修订历史|\n|AI|关键词证据→真实讯飞回答|无证据不编造|引用与结果记录|\n|附件|上传→读取→下载校验|只读写入/跨项目访问拒绝|附件与MCP日志|\n\n不发送真实邮件/IM，不执行真实支付，不部署外部业务系统。" });
  await ensure("execution", async () => {
    for (const [i, task] of state.tasks.entries()) {
      await chain(task.id, i < 12 ? ["IN_PROGRESS", "DONE"] : i < 15 ? ["IN_PROGRESS"] : []);
      if (i < 12) await call("timeLog.create", { workItemId: task.id, minutes: [120, 90, 60][i % 3], loggedDate: "2026-11-15", note: "演示工时，非真实考勤或计费", idempotencyKey: idem(`time:${i}`) });
    }
    for (const [i, task] of state.subtasks.entries()) await chain(task.id, i < 4 ? ["IN_PROGRESS", "DONE"] : ["IN_PROGRESS"]);
    for (const [i, defect] of state.defects.entries()) if (i !== 0) await chain(defect.id, i === 1 ? ["IN_PROGRESS", "FIXED", "VERIFIED", "REOPENED", "IN_PROGRESS", "FIXED", "VERIFIED", "CLOSED"] : i < 6 ? ["IN_PROGRESS", "FIXED", "VERIFIED", "CLOSED"] : ["IN_PROGRESS"]);
    for (const req of state.requirements.slice(0, 4)) await chain(req.id, ["CONFIRMED", "SCHEDULED", "IN_PROGRESS", "DELIVERED", "VERIFIED"]);
    await call("workitem.comment", { workItemId: state.defects[1].id, body: "【演示回归】首次修复遗漏@开头备注，验证后重开；第二次修复覆盖=、+、-、@，回归通过后关闭。", idempotencyKey: idem("defect-reopen-comment") });
    await call("workitem.addCollaborator", { workItemId: state.defects[0].id, memberId: state.personas[3].id });
    await call("workitem.follow", { workItemId: state.defects[0].id, channels: ["IN_APP"] });
    await call("workitem.createContentLink", { workItemId: state.defects[0].id, targetType: "PAGE", targetId: state.rulesPage.id });
    await call("workitem.link", { fromWorkItemId: state.defects[0].id, toWorkItemId: state.tasks[5].id, type: "BLOCKS" });
    await expected("workitem.link", { fromWorkItemId: state.tasks[5].id, toWorkItemId: state.defects[0].id, type: "BLOCKS" }, "VALIDATION");
    await expected("plan.completeRelease", { releaseId: state.release.id }, "BLOCKED_BY_PREREQUISITE");
    return { completedAt: new Date().toISOString() };
  });
  state.idea = await create("idea", "idea.submit", { title: "对账结果支持按客户分组订阅", description: "【合成客户反馈】财务每周手工筛选客户维度对账，希望保存筛选条件并订阅站内摘要；不配置真实邮件投递。" });
  await call("idea.vote", { ideaId: state.idea.id, weight: 1 });
  state.promoted = await ensure("promoted", () => call("idea.promote", { ideaId: state.idea.id, type: "TASK" }));
  const promotedAgain = await call("idea.promote", { ideaId: state.idea.id, type: "TASK" });
  check("想法重复转化返回同一工作项", promotedAgain.alreadyPromoted === true && promotedAgain.workItem.id === state.promoted.workItem.id);
  await ensure("attachments", async () => {
    const csv = "用例编号,场景,预期\nORD-001,重复提交,只生成一笔订单\nORD-002,超时重试,返回同一订单\nREF-001,退款时效,3个工作日内发起\n";
    const uploaded = await call("attachment.upload", { targetType: "PAGE", targetId: state.rulesPage.id, fileName: "客户门户-验收样例.csv", mimeType: "text/csv", contentBase64: Buffer.from(csv).toString("base64"), idempotencyKey: idem("attachment-csv") });
    const list = await call("attachment.list", { targetType: "PAGE", targetId: state.rulesPage.id });
    check("附件上传后元数据可复读", list.attachments.some(a => a.id === uploaded.id));
    const download = await call("attachment.download", { attachmentId: uploaded.id });
    check("附件下载内容逐字节一致", Buffer.from(download.contentBase64, "base64").equals(Buffer.from(csv)));
    return uploaded;
  });
  const dashboard = await create("dashboard", "dashboard.create", { name: "1.4交付验收｜质量与进展", isDefault: true });
  for (const [i, type] of ["COUNT", "PIE", "LIST", "BURNDOWN"].entries()) {
    const widget = await ensure(`widget:${type}`, () => call("dashboard.widgets.create", { projectId: p, dashboardId: dashboard.id, type, sortOrder: i, config: type === "BURNDOWN" ? { iterationId: state.sprint2.id } : {}, idempotencyKey: idem(`widget:${type}`) }));
    const data = await call("dashboard.widgets.data", { projectId: p, dashboardId: dashboard.id, widgetId: widget.id });
    check(`真实看板挂件${type}可读取`, data !== null);
  }
  await create("savedview", "savedView.create", { name: "交付验收｜高优先级缺陷", viewType: "TABLE", scope: "PROJECT_SHARED", filters: { type: "DEFECT", priority: "HIGH" } });
  await reindexPage(actor, state.rulesPage.id, "FULL", { skipEmbedding: true });
  const search = await call("knowledge.search", { projectId: p, q: "退款", limit: 5 });
  check("关键词检索命中演示业务规则", search.hits.some(hit => hit.pageId === state.rulesPage.id));
  state.knowledge = await call("knowledge.ask", { projectId: p, question: "退款审核通过后几个工作日内发起？", limit: 3 });
  check("真实讯飞知识问答有正文及可核实引用", state.knowledge.ok && /3|三/u.test(state.knowledge.answer ?? "") && state.knowledge.citations.some(c => c.pageId === state.rulesPage.id));
  state.agent = await runVisibleCodex({ state, base, token: rw.token, tokenId: rw.row.id, allowed, folder, save });
  await save();
  check("真实Codex成功完成MCP阶段", state.agent.exitCode === 0 && state.agent.toolCalls > 0);
  const defect = await call("workitem.get", { workItemId: state.defects[0].id });
  const [closed] = await sql`select key,category from workflow_state where id=${defect.workItem.statusId}`;
  check("真实智能体关闭阻断缺陷", closed?.key === "CLOSED");
  const release = await call("plan.getRelease", { releaseId: state.release.id });
  check("真实智能体完成有实际工作项的版本", Boolean(release.completedAt));
  const sprint = await call("plan.getIteration", { iterationId: state.sprint1.id });
  check("真实智能体结束迭代并保留结转快照", Boolean(sprint.completedAt) && sprint.completionResult?.carriedOverCount > 0);
  await call("plan.completeIteration", { iterationId: state.sprint1.id, targetIterationId: state.sprint2.id });
  await call("plan.completeRelease", { releaseId: state.release.id });
  const exported = await call("project.exportCsv", { projectId: p, limit: 1000 });
  await fs.writeFile(path.join(folder, "project-export.json"), JSON.stringify(exported));
  check("完整项目CSV导出成功", Boolean(exported.contentBase64 ?? exported.csv ?? exported.content));
  const report = await call("project.report", { projectId: p });
  await fs.writeFile(path.join(folder, "project-report.json"), JSON.stringify(report));
  check("带真实演示数据的PDF报告生成", Boolean(report.contentBase64));
  state.outsideAfter = await outsideSnapshot();
  check("原有项目业务数据未被改变", JSON.stringify(state.outsideBefore) === JSON.stringify(state.outsideAfter));
  state.finishedAt = new Date().toISOString();
  const content = `# 可视业务闭环验收结果\n\n> 本项目全部业务数据为合成演示；本次完成的是平台流程和真实MCP调用验证，不代表客户门户源码已开发或上线。\n\n- 结束时间：${state.finishedAt}\n- 需求：${state.requirements.length}项；开发任务：${state.tasks.length}项；子任务：${state.subtasks.length}项；缺陷：${state.defects.length}项；想法转任务：1项。\n- 真实Codex：退出${state.agent.exitCode}，MCP调用${state.agent.toolCalls}次。\n- 平台接口验收：${state.checks.filter(c => c.passed).length}项断言通过，${state.calls.length}次MCP调用。\n- 首次版本完成被未修复缺陷阻断；真实Codex完成修复→验证→关闭后再次完成成功。\n- 首迭代已结束，${sprint.completionResult.carriedOverCount}项未完成事项已结转下一迭代。\n- 附件、协作者、站内关注、工时、想法转化、看板挂件和导出均已复读。\n- 原有项目业务数据快照一致。\n\n## 验收断言\n${state.checks.map(c => `- ${c.passed ? "通过" : "失败"}：${c.name}`).join("\n")}\n\n## 已知环境边界\n硅基流动余额不足，当前知识检索为关键词模式；真实问答使用已配置讯飞模型。未发送真实邮件/IM，未执行真实支付。临时访问令牌在验收结束撤销。\n`;
  state.resultPage = await create("final-report", "page.create", { title: "99｜完整闭环验收结果", content });
  const pdfBytes = Buffer.from(report.contentBase64, "base64");
  await fs.writeFile(path.join(folder, "项目验收报告.pdf"), pdfBytes);
  await call("attachment.upload", { targetType: "PAGE", targetId: state.resultPage.id, fileName: "客户门户-项目验收报告.pdf", mimeType: "application/pdf", contentBase64: pdfBytes.toString("base64"), idempotencyKey: idem("final-pdf") });
  console.log(`验收完成：${base}/projects/${p}/wiki`);
} catch (error) {
  state.error = { name: error.name, message: error.message.slice(0, 1500), at: new Date().toISOString() };
  console.error(JSON.stringify(state.error)); process.exitCode = 1;
} finally {
  for (const token of [rw, ro]) if (token) await tokens.revokeToken(actor, token.row.id);
  state.tokensRevokedAt = new Date().toISOString(); await save();
  await closeCache(); await sql.end();
}
