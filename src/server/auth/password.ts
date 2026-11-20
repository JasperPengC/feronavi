/**
 * 密码哈希 —— **Argon2id**（第 5.9 节）
 *
 * 与令牌的区别（数据模型第 0 节的「算法必须按用途分层」）：
 *   - 密码：Argon2id，慢哈希，能扛离线爆破
 *   - 会话/API 令牌：SHA-256，快哈希，因为每个请求都要查一次
 * 混用会出事：令牌用 Argon2id 会拖垮每个请求；密码用 SHA-256 则是安全事故。
 */
import { hash, verify } from "@node-rs/argon2";
import { DomainError } from "../../shared/errors.ts";

/** 匿名化后的哨兵值：**不是合法的 Argon2id 串**，任何密码校验都会失败（数据模型 1.3），但仍执行 dummy 校验 */
export const ANONYMIZED_PASSWORD_SENTINEL = "!";

/** OWASP 推荐档位：19 MiB 内存、2 次迭代、并行度 1 */
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

// 随机不可恢复明文预生成的真实 Argon2id；未知、注销与损坏凭据共用同成本负路径。
const DUMMY_HASH = "$argon2id$v=19$m=19456,t=2,p=1$b7S/vyjhilw9Ny/1oy7W2A$knIoDSjUatRjT98orkbmlVsmW3+iUjAy615w5/UhQwk";
let activeHashes = 0;
async function withHashSlot<T>(operation: () => Promise<T>): Promise<T> {
  // 每进程最多约 76 MiB Argon2工作内存；不建立可被洪水填满的等待队列。
  if (activeHashes >= 4) throw new DomainError("RATE_LIMITED", "登录服务繁忙，请稍后重试", null);
  activeHashes++;
  try { return await operation(); } finally { activeHashes--; }
}

export async function hashPassword(plain: string): Promise<string> {
  return withHashSlot(() => hash(plain, OPTS));
}

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  const valid = /^\$argon2(?:id|i|d)\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/.test(stored);
  return withHashSlot(async () => {
    try { return (await verify(valid ? stored : DUMMY_HASH, plain)) && valid; }
    catch {
      // 语法看似有效但底层拒绝解析的损坏凭据，也支付一次真实校验成本。
      if (valid) await verify(DUMMY_HASH, plain).catch(() => false);
      return false;
    }
  });
}

/**
 * 密码强度校验（第 5.9 节）：
 *   - 最小 12 字符（OWASP；GitLab 默认 8 偏松）
 *   - **不强制大小写/符号**（NIST SP 800-63B：长度优于复杂度）
 *   - 校验弱密码库
 */
const MIN_LENGTH = 12;
const WEAK = new Set([
  "password", "123456", "qwerty", "admin", "letmein", "welcome",
  "password123", "admin123456", "123456789012", "qwertyuiop12",
]);

export function validatePasswordStrength(pw: string): { ok: true } | { ok: false; reason: string } {
  if (pw.length < MIN_LENGTH) {
    return { ok: false, reason: `密码至少 ${MIN_LENGTH} 个字符` };
  }
  if (WEAK.has(pw.toLowerCase())) {
    return { ok: false, reason: "该密码在常见弱密码库中，请更换" };
  }
  // 不强制复杂度（NIST SP 800-63B），但拒绝单一字符重复
  if (/^(.)\1+$/.test(pw)) {
    return { ok: false, reason: "密码不能是单一字符的重复" };
  }
  return { ok: true };
}
