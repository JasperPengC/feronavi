import "./_env.ts";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { Writable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import {
  comment, idea, iteration, mcpClient, member, mcpToolPolicy, page, pageRevision,
  projectMembership, release, role, roleAssignment, workItem, workflowState,
} from "../src/db/schema.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { loadActor } from "../src/server/auth/actor-loader.ts";
import * as projectService from "../src/server/services/project.service.ts";
import * as tokenService from "../src/server/services/token.service.ts";
import { buildApp } from "../src/server/app.ts";
import { ensureInitialized } from "./_test-helpers.ts";
import { TOOL_NAMES } from "../src/server/mcp/tools.ts";

const checks: { name: string; passed: boolean }[] = [];
const verify = (name: string, passed: boolean, detail?: string) => {
  checks.push({ name, passed });
  console.log(`  ${passed ? "OK" : "FAIL"} ${name}${detail ? `：${detail}` : ""}`);
};
const nonce = crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
const marker = `AGENT${nonce}`;
const finalTitle = `${marker} 已完成联调任务`;
const finalPageTitle = `${marker} 项目联调记录`;
const finalPageContent = `# ${marker}\n\n由真实 Codex 客户端创建并更新。`;
const targetComment = `${marker} 评论写入并复读验证`;
const mcpMetrics: { toolName: string; success?: boolean; errorCode?: string }[] = [];
const logStream = new Writable({
  write(chunk, _encoding, callback) {
    try {
      const row = JSON.parse(String(chunk)) as { mcpCall?: { toolName?: string; success?: boolean; errorCode?: string } };
      if (row.mcpCall?.toolName) mcpMetrics.push(row.mcpCall as { toolName: string; success?: boolean; errorCode?: string });
    } catch { /* 仅收集结构化 MCP 调用指标。 */ }
    callback();
  },
});

await ensureInitialized();
const app = await buildApp({ logger: { level: "info", stream: logStream } });
let appStarted = false;
let tempDir: string | undefined;
let tokenId: string | undefined;
let projectId: string | undefined;
let taskId: string | undefined;
let pageId: string | undefined;
let codexExitCode: number;
let codexEventCount = 0;
let codexFinalLength = 0;
let codexFinalText = "";
let codexStderrLength = 0;
let codexDiagnostic = "none";
const codexEventTypes: string[] = [];
const codexItemTypes: string[] = [];
const codexErrorItemFields: string[] = [];
const codexErrorItemFlags = new Set<string>();
let codexFinalCategory = "unknown";
let codexDiagnosticFlags: string[] = [];

try {
  await app.listen({ port: Number(process.env.PORT ?? 3980), host: "127.0.0.1" });
  appStarted = true;
  const [adminRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "ADMIN")).limit(1);
  const [memberRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER")).limit(1);
  if (!adminRole || !memberRole) throw new Error("MISSING_BUILTIN_ROLE");

  const [adminRow] = await db.insert(member).values({
    username: `agent-${nonce.toLowerCase()}-admin`, email: `${nonce.toLowerCase()}-admin@agent.test`,
    name: "智能体联调管理员", status: "ACTIVE", timezone: "UTC",
    passwordHash: await hashPassword(`Agent-${nonce}-test-pass`),
  }).returning({ id: member.id });
  const [teammateRow] = await db.insert(member).values({
    username: `agent-${nonce.toLowerCase()}-member`, email: `${nonce.toLowerCase()}-member@agent.test`,
    name: "联调成员", status: "ACTIVE", timezone: "UTC",
    passwordHash: await hashPassword(`Member-${nonce}-test-pass`),
  }).returning({ id: member.id });
  await db.insert(roleAssignment).values({ memberId: adminRow!.id, roleId: adminRole.id, scopeType: "ORG", scopeId: null });
  const admin = (await loadActor(adminRow!.id))!;
  const createdProject = await projectService.createProject(admin, { key: `A${nonce}`, name: `${marker} 真实智能体验收` });
  projectId = createdProject.id;
  await db.insert(roleAssignment).values({ memberId: teammateRow!.id, roleId: memberRole.id, scopeType: "PROJECT", scopeId: projectId });
  const [projectMemberRole] = await db.select({ id: role.id }).from(role).where(eq(role.key, "MEMBER")).limit(1);
  await db.insert(projectMembership).values({ projectId, memberId: teammateRow!.id, roleId: projectMemberRole!.id });
  const createdToken = await tokenService.createToken(admin, {
    name: "一次性真实 Codex 联调", tier: "READ_WRITE", projectWhitelist: [projectId], allowedIpCidrs: ["127.0.0.1/32"],
  });
  tokenId = createdToken.row.id;
  const allowedTools = new Set([
    "whoami", "project.list", "project.get", "project.members", "meta.workflow", "meta.fields",
    "workitem.create", "workitem.assign", "workitem.update", "workitem.get", "workitem.transition",
    "workitem.comment", "workitem.comments", "page.create", "page.get", "page.update",
    "meta.capabilities", "meta.tool", "project.context", "workitem.list", "workitem.children",
    "plan.createIteration", "plan.getIteration", "plan.updateIteration", "plan.listIterations",
    "plan.completeIteration", "plan.archiveIteration", "plan.unarchiveIteration",
    "plan.createRelease", "plan.getRelease", "plan.completeRelease", "plan.archiveRelease", "plan.unarchiveRelease",
    "idea.submit", "idea.list", "idea.get", "idea.update", "idea.vote", "idea.promote",
  ]);
  await db.insert(mcpToolPolicy).values(TOOL_NAMES.filter((name) => !allowedTools.has(name)).map((toolName) => ({
    tokenId: tokenId!, toolName, effect: "DENY", argConstraints: {},
  })));

  tempDir = await mkdtemp(join(process.env.FERONAVI_TEST_DIRECTORY ?? process.cwd(), "codex-mcp-"));
  const bridgePath = resolve("packages/feronavi-mcp/bin/feronavi-mcp.mjs");
  const bridgeLauncherPath = join(tempDir, "feronavi-bridge.mjs");
  const bridgeSecretPath = join(tempDir, "bridge-secret.json");
  await writeFile(bridgeSecretPath, JSON.stringify({ url: process.env.BASE, token: createdToken.token }), { mode: 0o600 });
  await chmod(bridgeSecretPath, 0o600);
  await writeFile(bridgeLauncherPath, [
    'import { readFileSync } from "node:fs";',
    `const secret = JSON.parse(readFileSync(${JSON.stringify(bridgeSecretPath)}, "utf8"));`,
    "process.env.FERONAVI_URL = secret.url;",
    "process.env.FERONAVI_TOKEN = secret.token;",
    ...(process.env.MCP_BRIDGE_PACKAGE ? [
      'const { spawn } = await import("node:child_process");',
      `const child = spawn("npx", ${JSON.stringify(["--yes", "--cache", join(tempDir, "npm-cache"), "--package", process.env.MCP_BRIDGE_PACKAGE, "--", "feronavi-mcp"])}, { stdio: "inherit", env: process.env });`,
      'for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));',
      'child.on("error", () => { process.stderr.write("npx bridge failed to start\\n"); process.exitCode = 1; });',
      'child.on("exit", code => { process.exitCode = code ?? 1; });',
    ] : [`await import(${JSON.stringify(bridgePath)});`]),
    "",
  ].join("\n"), { mode: 0o600 });
  await chmod(bridgeLauncherPath, 0o600);
  const prompt = [
    "这是一个真实的 Feronavi MCP 联调任务。仅在给定项目中操作，不得执行公告、自动化、审批、删除或项目外写入。允许按下述要求完成并归档/恢复本次创建的迭代与版本。",
    `目标项目 ID：${projectId}`,
    "先调用 meta.capabilities、project.context 和 whoami、project.get、project.members、meta.workflow、meta.fields，确认项目、成员及可用能力。需要新工具字段时用 meta.tool 查契约。",
    `创建一个 TASK，标题为「${marker} 初始任务」，正文包含标记 ${marker}，创建时不要设置 assigneeId。必须再调用 workitem.assign，将它指派给 project.members 中名字为「联调成员」的人。`,
    `读取该工作项版本。先以当前版本更新标题为带有“第一次更新”的标题；然后故意再次使用已过期的旧版本更新，必须观察到 VERSION_CONFLICT；重新读取后，使用最新版本更新成精确标题「${finalTitle}」。`,
    `用户本人已明确授权你立即执行一次状态流转，不要再次询问或只给建议。读取该工作项的 allowedTransitions，选择IN_PROGRESS并实际调用 workitem.transition 一次。添加评论「${targetComment}」，再用 workitem.comments 复读。`,
    `新建一个标题为「${finalPageTitle}」的项目文档，先读取，再基于 currentRevisionId 更新正文为「${finalPageContent}」，最后再次读取确认。`,
    `创建一个迭代，name为「${marker} 迭代验收」，startDate=2026-11-15、endDate=2026-11-29；再将name更新为「${marker} 已确认迭代」，读取确认。将最初的TASK关联到该迭代，设estimatePoints=5、estimateHours=8，并复读。`,
    `创建一个REQUIREMENT，标题「${marker} 父需求」；再以它为parentId创建SUBTASK，标题「${marker} 子任务」，调用workitem.children确认层级。用workitem.list按迭代ID及q=${marker}筛选，确认原TASK在结果中。`,
    `提交想法，标题「${marker} 想法转化」，description包含${marker}；通过idea.list发现它、idea.get读取、idea.update将description改为「${marker} 已评审」、idea.vote投1票，再用idea.promote转成TASK（本人已授权）。复读转成的工作项和idea，确认转化关联。`,
    `补齐计划生命周期：新建name「${marker} 下一迭代」、startDate=2026-11-30、endDate=2026-12-14的迭代。调用plan.completeIteration结束「${marker} 已确认迭代」，targetIterationId为下一迭代ID，将最初TASK结转过去；重复一次相同结束请求，确认结果幂等。读取原迭代completedAt和TASK的iterationId确认。再归档原迭代并恢复。`,
    `创建name「${marker} 版本验收」的空版本，通过plan.completeRelease完成版本，复读completedAt，再归档并恢复该版本。这些仅针对本次新建对象的动作已获本人授权。`,
    "所有写入完成后复读工作项、文档、迭代和想法。最终只需报告每项是否完成、观察到的冲突码及最终状态，不要复述任何令牌或凭据。",
  ].join("\n");
  // 保留当前第三方provider，仅在本次子进程停用无关全局MCP；不改全局配置。
  const globalConfig = await readFile(join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "config.toml"), "utf8").catch(() => "");
  const otherServers = [...globalConfig.matchAll(/^\[mcp_servers\.([A-Za-z0-9_-]+)\]\s*$/gmu)].map((match) => match[1]!).filter((name) => name !== "feronavi");
  const args = [
    "exec", "--ephemeral", "--json", "--dangerously-bypass-approvals-and-sandbox", "--disable", "shell_tool", "--skip-git-repo-check", "-C", tempDir,
    ...otherServers.flatMap((name) => ["-c", `mcp_servers.${name}.enabled=false`]),
    "-c", `mcp_servers.feronavi.command=${JSON.stringify(process.execPath)}`,
    "-c", `mcp_servers.feronavi.args=${JSON.stringify([bridgeLauncherPath])}`,
    "-c", `mcp_servers.feronavi.enabled_tools=${JSON.stringify([...allowedTools])}`,
    prompt,
  ];
  const codexEnv = { ...process.env };
  delete codexEnv.FERONAVI_URL;
  delete codexEnv.FERONAVI_TOKEN;
  const child = spawn("codex", args, {
    cwd: tempDir,
    env: codexEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let overflow = false;
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
    if (stdout.length > 12 * 1024 * 1024) { overflow = true; child.kill("SIGTERM"); }
  });
  let stderrForClassification = "";
  child.stderr.on("data", (chunk) => {
    if (stderrForClassification.length < 128_000) stderrForClassification += String(chunk).slice(0, 128_000 - stderrForClassification.length);
  });
  const timeout = setTimeout(() => child.kill("SIGTERM"), 600_000);
  try {
    codexExitCode = await new Promise<number>((resolveExit, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolveExit(code ?? 1));
    });
  } finally { clearTimeout(timeout); }
  codexStderrLength = stderrForClassification.length;
  codexDiagnostic = /auth|not logged|sign.?in|api.?key|401/iu.test(stderrForClassification) ? "auth"
    : /mcp|server|config|spawn|permission|tool/iu.test(stderrForClassification) ? "mcp_or_permission"
      : /rate.?limit|quota|billing|credit/iu.test(stderrForClassification) ? "quota"
        : stderrForClassification.length ? "other_stderr" : "none";
  if (overflow) throw new Error("CODEX_OUTPUT_LIMIT");
  let codexErrorText = "";
  for (const line of stdout.split(/\r?\n/u)) {
    try {
      const event = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string; [key: string]: unknown } };
      if (!event.type) continue;
      codexEventCount++;
      if (!codexEventTypes.includes(event.type)) codexEventTypes.push(event.type);
      if (event.item?.type && !codexItemTypes.includes(event.item.type)) codexItemTypes.push(event.item.type);
      if (event.item?.type === "error") {
        for (const key of Object.keys(event.item)) if (!codexErrorItemFields.includes(key)) codexErrorItemFields.push(key);
        const fields = JSON.stringify(event.item);
        if (codexErrorText.length < 64_000) codexErrorText += fields.slice(0, 64_000 - codexErrorText.length);
        if (/ENOENT|No such file|command not found/iu.test(fields)) codexErrorItemFlags.add("command_missing");
        if (/MCP server/iu.test(fields)) codexErrorItemFlags.add("mcp_server_error");
        if (/failed to start|server exited/iu.test(fields)) codexErrorItemFlags.add("mcp_start_error");
        if (/FERONAVI_URL/iu.test(fields)) codexErrorItemFlags.add("url_env_error");
        if (/FERONAVI_TOKEN/iu.test(fields)) codexErrorItemFlags.add("token_env_error");
        if (/401|unauthorized|invalid token/iu.test(fields)) codexErrorItemFlags.add("http_auth_error");
        if (/ECONNREFUSED|connect|network/iu.test(fields)) codexErrorItemFlags.add("network_error");
      }
      if (event.type === "item.completed" && event.item?.type === "agent_message") {
        const finalText = String(event.item.text ?? "");
        codexFinalText = finalText.replaceAll(createdToken.token, "[redacted]").replace(/(?:fero_|sk-|ak-)[A-Za-z0-9_-]+/gu, "[redacted]");
        codexFinalLength = finalText.length;
        codexFinalCategory = /mcp.*(connect|server|tool)|tool.*(unavailable|not found)/iu.test(finalText) ? "mcp_unavailable"
          : /permission|denied|forbidden/iu.test(finalText) ? "permission"
            : /auth|api|provider|request failed/iu.test(finalText) ? "provider_request"
              : /conflict|完成|成功/iu.test(finalText) ? "task_response" : "other_response";
      }
    } catch { /* 仅保留事件类型和最终答复长度，不输出原始事件。 */ }
  }
  const diagnosticSource = `${stdout}\n${stderrForClassification}\n${codexErrorText}`;
  codexDiagnosticFlags = [
    /FERONAVI_URL/iu.test(diagnosticSource) ? "url_env_mentioned" : "",
    /FERONAVI_TOKEN/iu.test(diagnosticSource) ? "token_env_mentioned" : "",
    /ENOENT|No such file/iu.test(diagnosticSource) ? "command_missing" : "",
    /failed to (start|initialize)|server exited/iu.test(diagnosticSource) ? "mcp_start_error" : "",
    /401|unauthorized|invalid token/iu.test(diagnosticSource) ? "http_auth_error" : "",
    /ECONNREFUSED|connection refused|fetch failed/iu.test(diagnosticSource) ? "network_connect_error" : "",
    /ETIMEDOUT|ENOTFOUND|TLS|certificate/iu.test(diagnosticSource) ? "network_timeout_or_tls" : "",
    /tool.{0,30}(not found|unavailable|not available)|no tools/iu.test(diagnosticSource) ? "tool_registry_error" : "",
    /untrusted|approval required|permission denied/iu.test(diagnosticSource) ? "trust_or_permission" : "",
  ].filter(Boolean);
  if (!codexEventCount && codexExitCode !== 0) codexDiagnostic = "no_json_events";
  else if (codexDiagnosticFlags.length) codexDiagnostic = "mcp_start_or_config";
  stdout = "";
  stderrForClassification = "";
  codexErrorText = "";
  verify("真实 Codex CLI 成功退出并返回最终答复", codexExitCode === 0 && codexEventCount > 0 && codexFinalLength > 0);

  const [client] = await db.select({ clientName: mcpClient.clientName, clientVersion: mcpClient.clientVersion, callCount: mcpClient.callCount })
    .from(mcpClient).where(eq(mcpClient.tokenId, tokenId)).limit(1);
  verify("服务端登记真实 Codex MCP 客户端", !!client?.clientName && !!client.clientVersion);
  verify("Codex 完成至少 10 次 MCP 工具调用", (client?.callCount ?? 0) >= 10);
  const requiredToolNames = [
    "whoami", "project.get", "project.members", "meta.workflow", "meta.fields", "workitem.create",
    "workitem.assign", "workitem.update", "workitem.get", "workitem.transition", "workitem.comment",
    "workitem.comments", "page.create", "page.get", "page.update",
    "meta.capabilities", "project.context", "workitem.list", "workitem.children",
    "plan.createIteration", "plan.getIteration", "plan.updateIteration",
    "plan.completeIteration", "plan.archiveIteration", "plan.unarchiveIteration",
    "plan.createRelease", "plan.getRelease", "plan.completeRelease", "plan.archiveRelease", "plan.unarchiveRelease",
    "idea.submit", "idea.list", "idea.get", "idea.update", "idea.vote", "idea.promote",
  ];
  const missingToolCalls = requiredToolNames.filter((name) => !mcpMetrics.some((metric) => metric.toolName === name && metric.success === true));
  verify("MCP 调用覆盖项目/成员/工作流读取和所需写工具", missingToolCalls.length === 0, missingToolCalls.length ? missingToolCalls.join(", ") : `${mcpMetrics.length} calls`);
  verify("服务端确实返回 VERSION_CONFLICT", mcpMetrics.some((metric) => metric.toolName === "workitem.update" && metric.success === false && metric.errorCode === "VERSION_CONFLICT"));

  const [savedTask] = await db.select().from(workItem).where(and(eq(workItem.projectId, projectId), eq(workItem.title, finalTitle))).limit(1);
  taskId = savedTask?.id;
  verify("工作项最终标题与冲突恢复结果持久化", !!savedTask && savedTask.version >= 3);
  verify("工作项已指派给联调成员", savedTask?.assigneeId === teammateRow!.id);
  const [finalState] = savedTask?.statusId
    ? await db.select({ category: workflowState.category }).from(workflowState).where(eq(workflowState.id, savedTask.statusId)).limit(1)
    : [];
  verify("工作项已成功迁移并离开起始状态", !!finalState && finalState.category !== "NOT_STARTED"
    && mcpMetrics.some((metric) => metric.toolName === "workitem.transition" && metric.success === true));
  if (taskId) {
    const comments = await db.select({ id: comment.id }).from(comment).where(and(eq(comment.targetType, "WORK_ITEM"), eq(comment.targetId, taskId), eq(comment.body, targetComment)));
    verify("评论已写入数据库", comments.length === 1);
  } else verify("评论已写入数据库", false);

  const [savedPage] = await db.select().from(page).where(and(eq(page.projectId, projectId), eq(page.title, finalPageTitle))).limit(1);
  pageId = savedPage?.id;
  verify("文档最终正文与当前版本已持久化", !!savedPage && !!savedPage.currentRevisionId);
  if (pageId) {
    const revisions = await db.select({ id: pageRevision.id, content: pageRevision.content }).from(pageRevision).where(eq(pageRevision.pageId, pageId));
    verify("文档至少生成两个不可变版本且当前版本为最终正文", revisions.length >= 2 && revisions.some((revision) => revision.id === savedPage.currentRevisionId && revision.content === finalPageContent));
  } else verify("文档至少生成两个不可变版本并保留最终正文", false);
  const [savedIteration] = await db.select().from(iteration).where(and(eq(iteration.projectId, projectId), eq(iteration.name, `${marker} 已确认迭代`))).limit(1);
  verify("迭代创建与更新持久化", !!savedIteration && savedIteration.startDate === "2026-11-15" && savedIteration.endDate === "2026-11-29");
  const [nextIteration] = await db.select().from(iteration).where(and(eq(iteration.projectId, projectId), eq(iteration.name, `${marker} 下一迭代`))).limit(1);
  verify("任务结转后排期与点数小时估算持久化", !!nextIteration && savedTask?.iterationId === nextIteration.id && Number(savedTask.estimatePoints) === 5 && Number(savedTask.estimateHours) === 8);
  verify("结束迭代持久化且归档后已恢复", !!savedIteration?.completedAt && !!savedIteration.completionResult && !savedIteration.archivedAt);
  const [savedRelease] = await db.select().from(release).where(and(eq(release.projectId, projectId), eq(release.name, `${marker} 版本验收`))).limit(1);
  verify("版本完成持久化且归档后已恢复", !!savedRelease?.completedAt && !!savedRelease.completionResult && !savedRelease.archivedAt);
  const hierarchy = await db.select().from(workItem).where(eq(workItem.projectId, projectId));
  const parent = hierarchy.find((row) => row.title === `${marker} 父需求` && row.type === "REQUIREMENT");
  verify("需求拆解子任务层级持久化", !!parent && hierarchy.some((row) => row.title === `${marker} 子任务` && row.type === "SUBTASK" && row.parentId === parent.id));
  const [savedIdea] = await db.select().from(idea).where(and(eq(idea.projectId, projectId), eq(idea.title, `${marker} 想法转化`))).limit(1);
  verify("想法评审投票转化闭环持久化", !!savedIdea && savedIdea.description === `${marker} 已评审` && !!savedIdea.promotedWorkItemId && hierarchy.some((row) => row.id === savedIdea.promotedWorkItemId && row.type === "TASK"));
  const authoredItems = await db.select({ projectId: workItem.projectId }).from(workItem).where(eq(workItem.reporterId, adminRow!.id));
  const authoredIdeas = await db.select({ projectId: idea.projectId }).from(idea).where(eq(idea.submittedByMemberId, adminRow!.id));
  const authoredPages = await db.select({ projectId: page.projectId }).from(page).innerJoin(pageRevision, eq(pageRevision.pageId, page.id)).where(eq(pageRevision.authorId, adminRow!.id));
  verify("任务、想法及文档写入均只落在当前随机验收项目", authoredItems.length >= 4 && authoredIdeas.length > 0 && authoredPages.length > 0 && [...authoredItems, ...authoredIdeas, ...authoredPages].every((row) => row.projectId === projectId));
} catch (error) {
  const code = error instanceof Error ? error.message.replace(/[^A-Z0-9_]/gu, "_").slice(0, 80) : "UNKNOWN_ERROR";
  verify(`Codex 联调链路异常（${code}）`, false);
} finally {
  if (process.env.CODEX_ACCEPT_REPORT) {
    await writeFile(process.env.CODEX_ACCEPT_REPORT, JSON.stringify({ checks, mcpMetrics, codexFinalText, codexDiagnosticFlags }, null, 2));
  }
  if (appStarted) await app.close();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  await sql.end();
}

const passed = checks.filter((check) => check.passed).length;
const failed = checks.length - passed;
console.log(`Codex 脱敏诊断：退出码 ${codexExitCode ?? "未启动"}，stderr ${codexStderrLength} 字符，类别 ${codexDiagnostic}/${codexFinalCategory}，事件 ${codexEventTypes.join(",") || "无"}，内容类型 ${codexItemTypes.join(",") || "无"}，错误字段=${codexErrorItemFields.join(",") || "无"}，错误分类=${[...codexErrorItemFlags].join(",") || "none"}，flags=${codexDiagnosticFlags.join(",") || "none"}，工具调用 ${mcpMetrics.length} 次。`);
console.log(`\n结果：${passed} 通过 / ${failed} 失败；MCP 工具调用 ${mcpMetrics.length} 次。`);
process.exit(failed === 0 ? 0 : 1);
