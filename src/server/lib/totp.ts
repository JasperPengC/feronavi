/**
 * TOTP（RFC 6238）+ Base32（RFC 4648）
 *
 * 自己实现而不引依赖：算法是确定的，几十行内可审计；引三方库反而多一个供应链面。
 * **正确性用 RFC 6238 附录 B 的官方向量验证**（见 e2e-2fa：种子 "12345678901234567890"
 * 在 T=59/1111111109/1111111111/1234567890/2000000000 的预期值）—— 这不是"自测通过"，是对标准。
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error(`Base32 含非法字符：${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateSecret(bytes = 20): Buffer {
  return randomBytes(bytes);
}

/** HOTP（RFC 4226）：HMAC-SHA1 + 动态截断 */
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(buf).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const code = ((mac[offset]! & 0x7f) << 24) | ((mac[offset + 1]! & 0xff) << 16)
    | ((mac[offset + 2]! & 0xff) << 8) | (mac[offset + 3]! & 0xff);
  return String(code % 10 ** digits).padStart(digits, "0");
}

/** TOTP：默认 30 秒步长、6 位 */
export function totp(secret: Buffer, atMs: number = Date.now(), stepSec = 30, digits = 6): string {
  return hotp(secret, Math.floor(atMs / 1000 / stepSec), digits);
}

/**
 * 校验动态码：允许前后各一个时间窗（时钟漂移是现实存在的，不容忍会让用户"明明对却登不进"）。
 * 用 `timingSafeEqual` 比较，避免把校验变成计时侧信道。
 */
export function verifyTotp(secret: Buffer, code: string, opts: { atMs?: number; window?: number } = {}): boolean {
  const at = opts.atMs ?? Date.now();
  const w = opts.window ?? 1;
  const given = Buffer.from(code.padStart(6, "0"));
  for (let i = -w; i <= w; i++) {
    const expect = Buffer.from(totp(secret, at + i * 30_000));
    if (given.length === expect.length && timingSafeEqual(given, expect)) return true;
  }
  return false;
}

/** otpauth:// 供验证器 App 扫码（标签里的 issuer 与账户名由调用方拼好） */
export function otpauthUrl(secretBase32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}
