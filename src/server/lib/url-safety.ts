/**
 * 出站 URL 安全校验（规范 C-17 / C-27 / 第 5.10 节）
 *
 * 规范原文：**所有用户可控的出站 URL 必须过同一个模块**，不允许各处自己写一份白名单。
 * 使用者：`webhook_endpoint.url`（含重试与死信重投的每一次请求）、`ai_provider_config.base_url`、
 * `integration.base_url`。因此本文件是**唯一实现**，其余地方只调用它。
 *
 * 校验要点（照规范逐条）：
 *   1 协议白名单：仅 https；自托管可显式允许 http
 *   2 拒解析到私网 / 回环 / link-local / 组播 / 云元数据（169.254.169.254 等）
 *   3 返回校验后的 DNS 地址，由 safe-fetch 固定到实际连接，避免二次解析漂移
 *   4 safe-fetch 拒绝重定向，要求直接配置最终地址
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { DomainError } from "../../shared/errors.ts";

const METADATA_HOSTS = new Set([
  "169.254.169.254", "metadata.google.internal", "100.100.100.200", "fd00:ec2::254",
]);

/** 自托管允许 http 的唯一开关（默认关闭） */
export function allowInsecureHttp(): boolean {
  return process.env.ALLOW_INSECURE_OUTBOUND_HTTP === "1";
}

function isPrivateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;                 // link-local（含云元数据网段）
  if (a === 172 && b >= 16 && b <= 31) return true;        // 172.16/12
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && (p[2] === 0 || p[2] === 2)) return true;
  if (a === 198 && (b === 18 || b === 19 || b === 51 && p[2] === 100)) return true;
  if (a === 203 && b === 0 && p[2] === 113) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;       // CGNAT
  if (a >= 224) return true;                               // 组播/保留
  return false;
}

function isPrivateV6(ip: string): boolean {
  // WHATWG 规范化压缩形式与嵌入 IPv4，不能只匹配 fe80 字符串（link-local 是 /10）。
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const [left, right] = canonical.split("::");
  const head = left ? left.split(":") : [];
  const tail = right ? right.split(":") : [];
  const words = right !== undefined ? [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail] : head;
  const parts = words.map(word => parseInt(word, 16));
  if (parts.slice(0, 5).every(word => word === 0) && parts[5] === 0xffff) {
    const high = parts[6]!, low = parts[7]!;
    return isPrivateV4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  // 仅允许全球单播 2000::/3；排除文档/协议分配与6to4隧道。
  return (parts[0]! & 0xe000) !== 0x2000 || parts[0] === 0x2002
    || parts[0] === 0x2001 && (parts[1]! < 0x200 || parts[1] === 0xdb8);
}

export function isBlockedAddress(ip: string): boolean {
  if (METADATA_HOSTS.has(ip)) return true;
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) return isPrivateV6(ip);
  return true;                                             // 不是合法 IP → 拒绝
}

export interface UrlCheckOptions {
  /** 私有部署：仅允许 http 协议（仍拦内网地址） */
  allowHttp?: boolean;
  /** 跳过 DNS（离线单测用；生产不得开启） */
  skipDns?: boolean;
  signal?: AbortSignal;
}

/** 不通过则抛 VALIDATION。返回解析地址供 safe-fetch 固定实际连接。 */
export async function assertSafeOutboundUrl(rawUrl: string, opts: UrlCheckOptions = {}): Promise<{ url: URL; addresses: string[] }> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new DomainError("VALIDATION", "URL 格式不合法", null); }
  if (url.username || url.password) throw new DomainError("VALIDATION", "出站 URL 不能包含用户名或密码", null);

  const httpsOk = url.protocol === "https:";
  const httpOk = url.protocol === "http:" && (opts.allowHttp === true || allowInsecureHttp());
  if (!httpsOk && !httpOk) {
    throw new DomainError("VALIDATION", "出站地址必须使用 https（自托管可显式允许 http）", { protocol: url.protocol });
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (METADATA_HOSTS.has(host.toLowerCase())) throw new DomainError("VALIDATION", "该地址不被允许", null);

  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new DomainError("VALIDATION", "不允许指向内网或保留地址", null);
    return { url, addresses: [host] };
  }
  if (opts.skipDns) return { url, addresses: [] };

  const signal = opts.signal ?? AbortSignal.timeout(10_000);
  signal.throwIfAborted();
  let abortLookup: () => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    abortLookup = () => reject(signal.reason);
    signal.addEventListener("abort", abortLookup, { once: true });
  });
  let addrs: { address: string }[];
  try { addrs = await Promise.race([lookup(host, { all: true }), cancelled]); }
  catch {
    signal.throwIfAborted();
    throw new DomainError("VALIDATION", "域名无法解析", { host });
  } finally { signal.removeEventListener("abort", abortLookup); }
  if (addrs.length === 0) throw new DomainError("VALIDATION", "域名无法解析", { host });
  for (const a of addrs) {
    // 关键：域名解析到内网同样拦（DNS rebinding / 内网探测的常见手法）
    if (isBlockedAddress(a.address)) throw new DomainError("VALIDATION", "该域名解析到内网或保留地址，已拒绝", null);
  }
  return { url, addresses: addrs.map((a) => a.address) };
}
