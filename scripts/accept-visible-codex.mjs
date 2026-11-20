/** 真实Codex只获得本轮新项目的临时MCP桥；不改全局配置，不保留原始transcript。 */
import fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { sql } from "../src/db/index.ts";

export async function runVisibleCodex({ state, base, token, tokenId, folder, save }) {
  if (state.agent?.exitCode === 0 && state.agent?.toolCalls > 0) return state.agent;
  const bridgeSecretPath = path.join(folder, "bridge-secret.json");
  const bridgePath = path.join(folder, "bridge.mjs");
  await fs.writeFile(bridgeSecretPath, JSON.stringify({ url: base, token }), { mode: 0o600 });
  await fs.writeFile(bridgePath, [
    'import {readFileSync} from "node:fs";',
    `const config=JSON.parse(readFileSync(${JSON.stringify(bridgeSecretPath)},"utf8"));`,
    "process.env.FERONAVI_URL=config.url;process.env.FERONAVI_TOKEN=config.token;",
    `await import(${JSON.stringify(path.resolve("packages/feronavi-mcp/bin/feronavi-mcp.mjs"))});`,
  ].join("\n"), { mode: 0o600 });
  const permitted = ["whoami", "meta.capabilities", "meta.tool", "meta.workflow", "project.context", "project.get", "project.members", "workitem.get", "workitem.list", "workitem.update", "workitem.assign", "workitem.transition", "workitem.comment", "workitem.comments", "page.get", "page.update", "page.create", "page.list", "knowledge.search", "knowledge.ask", "plan.getIteration", "plan.getRelease", "plan.completeIteration", "plan.completeRelease"];
  const prompt = [
    "用户已明确授权你立即在本机平台完成此联调演示项目的业务闭环，含本次演示对象状态流转、计划结束、版本完成和评论/文档写入。不要再次请求批准。",
    "全部客户、人员和业务为合成演示数据。你是在模拟团队业务记录，不能宣称自己修复了客户门户源码或已真实发布产品。禁止项目外操作、删除、公告、外部消息和配置修改。只用给定MCP，不使用shell、文件、网络或其他工具。",
    `项目ID=${state.project.id}，项目名称=${state.project.key}。先读whoami、project.context、meta.workflow确认身份和状态；有不明契约用meta.tool查询，工具参数不要猜。`,
    `关键缺陷ID=${state.defects[0].id}，「弱网连续提交生成重复订单」。先get，指派给后端${state.personas[1].id}，通过合法迁移IN_PROGRESS→FIXED→VERIFIED→CLOSED。每步使用最新version，评论写出“合成演示”的复现、requestId唯一约束修复方案、20并发及超时重试回归通过。这里的“通过”是合成验收记录，不能写成已执行外部订单系统测试。必须实际执行4次状态流转并最后复读CLOSED。`,
    `验证并发恢复：工作项ID=${state.tasks[12].id}。读取version后先追加description说明“智能体已评审，排入下一迭代”；再次用相同旧version更新，观察VERSION_CONFLICT，再读取最新版本正确更新description，保留原业务标题与关联。`,
    `文档修订：pageId=${state.resources.guide.id}。page.get读取currentRevisionId和正文，在原文末尾追加“## 智能体验收\n本次为真实Codex通过MCP执行的合成业务演示，未对外发布产品。”，用page.update携带expectedRevisionId提交；用旧revision故意再次提交，确认冲突并复读新正文。不要覆盖其他内容。`,
    `知识问答：先knowledge.search项目ID，q=退款；再knowledge.ask问“退款审核通过后几个工作日内发起？”。必须实际调用并检查answer非空、包含3个工作日及服务端引用；如果模型不可用，清楚记录实际错误，不能自己编造工具成功。`,
    `版本完成：releaseId=${state.release.id}。请先读release；关键缺陷关闭后其关联其他工作项已完成，实际调用plan.completeRelease，然后plan.getRelease确认completedAt。若被阻断，列出真实未完成项，不得移出范围或虚假关闭其他事项掩盖问题。`,
    `迭代结束：源iterationId=${state.sprint1.id}，下一迭代=${state.sprint2.id}。实际调用plan.completeIteration，targetIterationId为下一迭代，复读源完成快照；调用workitem.list按目标迭代过滤核对结转，不要结束下一迭代。`,
    "最后在本项目新建page「03｜真实Codex执行记录」，用Markdown记录实际完成的动作、观察到的两个冲突、知识问答及引用、版本和迭代结果、未完成事项，以及合成演示边界。只报告实际工具结果，不复制任何密钥/令牌。最终答复简短中文。",
  ].join("\n\n");
  const config = await fs.readFile(path.join(process.env.CODEX_HOME ?? path.join(homedir(), ".codex"), "config.toml"), "utf8").catch(() => "");
  const others = [...config.matchAll(/^\[mcp_servers\.([A-Za-z0-9_-]+)\]\s*$/gmu)].map(m => m[1]).filter(n => n !== "feronavi");
  const args = ["exec", "--ephemeral", "--json", "--dangerously-bypass-approvals-and-sandbox", "--disable", "shell_tool", "--skip-git-repo-check", "-C", folder,
    ...others.flatMap(name => ["-c", `mcp_servers.${name}.enabled=false`]),
    "-c", `mcp_servers.feronavi.command=${JSON.stringify(process.execPath)}`,
    "-c", `mcp_servers.feronavi.args=${JSON.stringify([bridgePath])}`,
    "-c", `mcp_servers.feronavi.enabled_tools=${JSON.stringify(permitted)}`, prompt];
  const [before] = await sql`select coalesce(sum(call_count),0)::int as calls from mcp_client where token_id=${tokenId}`;
  const child = spawn("codex", args, { cwd: folder, env: { ...process.env, FERONAVI_TOKEN: "", FERONAVI_URL: "" }, stdio: ["ignore", "pipe", "pipe"] });
  let buffer = "", stderr = "", final = "";
  const calls = []; let events = 0, timedOut = false;
  const redact = text => text.replaceAll(token, "[redacted]").replace(/fero_[A-Za-z0-9_-]{30,}/g, "[redacted]");
  child.stdout.on("data", chunk => {
    buffer += String(chunk);
    if (buffer.length > 2_000_000) { child.kill("SIGTERM"); return; }
    const lines = buffer.split(/\r?\n/u); buffer = lines.pop() ?? "";
    for (const line of lines) {
      try {
        const event = JSON.parse(line); events++;
        if (event.type === "item.completed" && event.item?.type === "mcp_tool_call") {
          const item = event.item;
          calls.push({ tool: item.tool, server: item.server, status: item.status, isError: item.result?.isError ?? false });
          console.log(`Codex MCP ${calls.length}：${item.tool ?? "tool"} ${item.status ?? "completed"}`);
        }
        if (event.type === "item.completed" && event.item?.type === "agent_message") final = redact(String(event.item.text ?? ""));
      } catch { /* 不归档原始事件，避免意外泄露 */ }
    }
  });
  child.stderr.on("data", chunk => { if (stderr.length < 64_000) stderr += String(chunk); });
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, 720_000);
  let exitCode;
  try { exitCode = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", code => resolve(code ?? 1)); }); }
  finally { clearTimeout(timer); await fs.rm(bridgeSecretPath, { force: true }); }
  const [after] = await sql`select coalesce(sum(call_count),0)::int as calls from mcp_client where token_id=${tokenId}`;
  const result = { exitCode, timedOut, events, toolCalls: after.calls - before.calls, observedCalls: calls, final, stderrCharacters: stderr.length, stderrCategory: /quota|billing|credit|rate.limit/iu.test(stderr) ? "quota" : /auth|401|login/iu.test(stderr) ? "auth" : stderr.length ? "other" : "none", completedAt: new Date().toISOString() };
  await fs.writeFile(path.join(folder, "codex-result.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
  state.agent = result; await save(); return result;
}
