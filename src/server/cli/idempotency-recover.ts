/** 运维入口；默认 inspect，只读。写操作必须携带明确的结果确认和核对证据。 */
import { readFile } from "node:fs/promises";
import { sql } from "../../db/index.ts";
import { inspectIdempotency, recoverIdempotency } from "../services/idempotency-recovery.service.ts";

const usage = `用法：idempotency-recover [inspect|resolve] --actor-id <uuid> --scope <scope> --key <key>
resolve 额外要求：--expected-hash <sha256> --operator-id <uuid> --evidence <核对证据/工单引用>
  已确认业务回滚：--confirm-rolled-back
  已确认业务提交：--confirm-committed --response-file <JSON 响应文件>
请先核对数据库业务记录。证据原文保存在受控工单中；审计只保存其 SHA-256 摘要。`;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) { console.log(usage); return; }
  const mode = args[0]?.startsWith("--") ? "inspect" : args.shift() ?? "inspect";
  if (mode !== "inspect" && mode !== "resolve") throw new Error(usage);
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const allowed = new Set(["--actor-id", "--scope", "--key", "--expected-hash", "--operator-id", "--evidence", "--response-file"]);
  for (let i = 0; i < args.length; i++) {
    const option = args[i]!;
    if (values.has(option) || flags.has(option)) throw new Error(`重复参数：${option}`);
    if (option === "--confirm-rolled-back" || option === "--confirm-committed") { flags.add(option); continue; }
    if (!allowed.has(option) || !args[i + 1] || args[i + 1]!.startsWith("--")) throw new Error(`无效参数：${option}\n${usage}`);
    values.set(option, args[++i]!);
  }
  const required = (option: string) => { const value = values.get(option); if (!value) throw new Error(`缺少 ${option}\n${usage}`); return value; };
  const identity = { actorId: required("--actor-id"), scope: required("--scope"), key: required("--key") };
  if (mode === "inspect") {
    if (flags.size || [...values.keys()].some((key) => !["--actor-id", "--scope", "--key"].includes(key))) throw new Error("inspect 不接受写操作参数");
    console.log(JSON.stringify(await inspectIdempotency(identity), null, 2)); return;
  }
  if (flags.size !== 1) throw new Error("必须且只能选择 --confirm-rolled-back 或 --confirm-committed");
  const recovery = { ...identity, expectedRequestHash: required("--expected-hash"), operatorId: required("--operator-id"), evidence: required("--evidence") };
  if (flags.has("--confirm-committed")) {
    const response = JSON.parse(await readFile(required("--response-file"), "utf8"));
    await recoverIdempotency({ ...recovery, resolution: "COMMITTED", response });
  } else {
    if (values.has("--response-file")) throw new Error("回滚恢复不接受响应文件");
    await recoverIdempotency({ ...recovery, resolution: "ROLLED_BACK" });
  }
  console.log(JSON.stringify({ recovered: true, resolution: flags.has("--confirm-committed") ? "COMMITTED" : "ROLLED_BACK" }));
}
try { await main(); }
catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
finally { await sql.end({ timeout: 5 }); }
