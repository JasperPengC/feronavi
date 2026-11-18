/**
 * CLI `reset-password` —— 管理员自己忘密码时的**唯一出路**（第 5.11 节）
 *
 * 用法：
 *   docker compose exec app node dist-server/cli/reset-password.js --user <name>
 *   docker compose exec app node dist-server/cli/reset-password.js --email <addr>
 *
 * 四条契约（第 5.11 节）：
 *   1 形态：与应用同镜像的**独立入口**，不新起服务
 *   2 行为：与界面路径**同一张表** `password_reset_token`，生成一次性重置链接
 *   3 权限：**能 `docker compose exec` 的人 = 已有服务器权限**，不额外鉴权
 *   4 **不得**把明文密码作为参数传入（会被 `ps` / shell history 记录）—— 只发链接
 */
import { findMemberByUserOrEmail, issueResetToken } from "../services/password-reset.service.ts";
import { sql } from "../../db/index.ts";

function parseArgs(argv: string[]): { user?: string; email?: string } {
  const out: { user?: string; email?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--user") out.user = argv[++i];
    else if (argv[i] === "--email") out.email = argv[++i];
  }
  return out;
}

async function main() {
  const { user, email } = parseArgs(process.argv.slice(2));
  const identifier = user ?? email;

  if (!identifier) {
    console.error("用法: reset-password --user <用户名> | --email <邮箱>");
    process.exit(2);
  }

  // ⚠️ DB 不可用时必须给出**明确错误**而不是静默失败（第 3 步判据）
  let found;
  try {
    found = await findMemberByUserOrEmail(identifier);
  } catch (e) {
    console.error("错误：无法连接数据库。请确认数据库服务已启动且 DATABASE_URL 正确。");
    console.error(`  原因：${(e as Error).message}`);
    process.exit(1);
  }

  if (!found) {
    console.error(`错误：找不到成员「${identifier}」。`);
    process.exit(1);
  }
  if (found.status === "ANONYMIZED") {
    console.error(`错误：成员「${found.username}」已注销，无法重置密码。`);
    process.exit(1);
  }

  // issuedByMemberId = NULL：CLI 不是某个登录用户触发的
  const { token, expiresAt } = await issueResetToken({ memberId: found.id, issuedByMemberId: null });

  // 只输出链接，不输出密码（契约 4）
  console.log("");
  console.log(`成员：${found.username}`);
  console.log(`重置链接（${Math.round((expiresAt.getTime() - Date.now()) / 60000)} 分钟内有效，仅可使用一次）：`);
  console.log("");
  console.log(`  /reset-password?token=${token}`);
  console.log("");
  console.log("请通过安全渠道交给该成员。此链接等同于登录凭证，切勿写入日志或工单。");
  console.log("");

  await sql.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("未预期错误：", e);
  try { await sql.end(); } catch { /* 忽略 */ }
  process.exit(1);
});
