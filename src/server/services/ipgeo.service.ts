/**
 * IP 归属地库（ip2region xdb）+ 在线更新
 *
 * 选型理由（2026-11-01）：ip2region 的归属地格式是中文、单文件离线查询
 * （自托管实例**不外发用户 IP**，隐私正解）、Apache-2.0。npm 包 ip2region-ts 随包内置一份 xdb。
 *
 * 数据三态：DATA_DIR/ipgeo/ip2region.xdb（在线更新的新版）> 包内置 xdb > 不可用。
 * 更新流程：下载临时文件 → 加载并试查一次（坏文件直接拒绝）→ 原子改名 → 重建搜索器；
 * meta.json 记录 lastCheckAt / lastUpdateAt，供系统页展示。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { DomainError } from "../../shared/errors.ts";

const DATA_DIR = process.env.DATA_DIR;
const IPGEO_DIR = DATA_DIR ? join(DATA_DIR, "ipgeo") : "/data/ipgeo";
const CUSTOM_XDB = join(IPGEO_DIR, "ip2region.xdb");
const META_FILE = join(IPGEO_DIR, "meta.json");

/** 上游源（2026-11-01 实测）：
 *  ① gitee Contents API——raw 对 >1MB 文件要求登录（403），但 API 返回完整 base64，国内可达性最好；
 *  ② github raw 直链——海外服务器首选（数据文件已更名 ip2region_v4.xdb）。 */
const SOURCES: { url: string; decode: "base64-json" | "raw" }[] = [
  { url: "https://gitee.com/api/v5/repos/lionsoul/ip2region/contents/data/ip2region_v4.xdb?ref=master", decode: "base64-json" },
  { url: "https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v4.xdb", decode: "raw" },
];

interface XdbSearcher { search: (ip: string) => Promise<{ region: string; ioCount: number; took: number }> }

let searcherPromise: Promise<XdbSearcher | null> | null = null;
let searcherSource: "custom" | "bundled" | null = null;

function bundledXdbPath(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve("ip2region-ts/package.json");
    const p = join(dirname(pkg), "data", "ip2region.xdb");
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

async function loadSearcher(path: string, source: "custom" | "bundled"): Promise<XdbSearcher> {
  const { newWithFileOnly } = await import("ip2region-ts");
  const s = (await newWithFileOnly(path)) as unknown as XdbSearcher;
  await s.search("1.2.3.4");   // 试查一次，坏文件在这里暴露
  searcherSource = source;
  return s;
}

/** 惰性初始化（memoized）：自定义库优先，包内置兜底；都失败返回 null（查询降级为未知，不阻断服务） */
function getSearcher(): Promise<XdbSearcher | null> {
  if (!searcherPromise) {
    searcherPromise = (async () => {
      try {
        if (existsSync(CUSTOM_XDB)) {
          try { return await loadSearcher(CUSTOM_XDB, "custom"); } catch { /* 自定义库坏了 → 落回内置 */ }
        }
        const bundled = bundledXdbPath();
        if (bundled) return await loadSearcher(bundled, "bundled");
        return null;
      } catch {
        return null;
      }
    })();
  }
  return searcherPromise;
}

export function warmupIpGeo(): void {
  void getSearcher();
}

const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * 归属地展示串：查不到 / 未就绪返回 null。
 * 兼容两种上游格式：
 *   · v2 经典（包内置）：国家|区域|省|市|ISP，0 表示空，内网为「内网IP」
 *   · v3.18+（在线更新的 ip2region_v4.xdb）：国家|省|市|ISP|国家码，保留 IP 为「Reserved」
 */
export async function lookupLocation(ip?: string | null): Promise<string | null> {
  if (!ip || !IP_RE.test(ip)) return null;
  const s = await getSearcher();
  if (!s) return null;
  let region: string | null;
  try {
    region = (await s.search(ip)).region ?? null;
  } catch {
    return null;
  }
  if (!region) return null;
  const parts = region.split("|").map((p) => p.trim());
  if (parts.includes("内网IP") || parts.includes("Reserved")) return "内网";
  const isV4 = parts.length >= 5 && /^[A-Za-z]{2}$/.test(parts[4] ?? "");
  const fields = isV4 ? [parts[0], parts[1], parts[2], parts[3]] : [parts[0], parts[2], parts[3], parts[4]];
  const label = fields.filter((p, i) => p && p !== "0" && fields.indexOf(p) === i).join(" ");
  return label || null;
}

interface IpGeoMeta { lastCheckAt?: string; lastUpdateAt?: string }

function readMeta(): IpGeoMeta {
  try { return JSON.parse(readFileSync(META_FILE, "utf8")) as IpGeoMeta; } catch { return {}; }
}

function writeMeta(meta: IpGeoMeta): void {
  try {
    mkdirSync(IPGEO_DIR, { recursive: true });
    writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
  } catch { /* meta 写失败不影响主功能 */ }
}

export function ipGeoStatus(): {
  available: boolean; source: "custom" | "bundled" | null;
  dataDate: string | null; sizeBytes: number | null;
  lastCheckAt: string | null; lastUpdateAt: string | null;
} {
  const path = searcherSource === "custom" ? CUSTOM_XDB : searcherSource === "bundled" ? bundledXdbPath() : null;
  const meta = readMeta();
  const stat = path && existsSync(path) ? statSync(path) : null;
  return {
    available: searcherSource !== null,
    source: searcherSource,
    dataDate: stat ? stat.mtime.toISOString() : null,
    sizeBytes: stat ? stat.size : null,
    lastCheckAt: meta.lastCheckAt ?? null,
    lastUpdateAt: meta.lastUpdateAt ?? null,
  };
}

async function fetchXdb(): Promise<{ bytes: Buffer }> {
  let lastErr: unknown = null;
  for (const src of SOURCES) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 60_000);
      const res = await fetch(src.url, { signal: ctl.signal, redirect: "follow" });
      clearTimeout(timer);
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      let bytes: Buffer;
      if (src.decode === "base64-json") {
        const j = (await res.json()) as { content?: string };
        if (!j.content) { lastErr = new Error("响应缺少 content"); continue; }
        bytes = Buffer.from(j.content, "base64");
      } else {
        bytes = Buffer.from(await res.arrayBuffer());
      }
      if (bytes.length < 1024 * 1024) { lastErr = new Error(`文件过小（${bytes.length}B），疑似坏包`); continue; }
      return { bytes };
    } catch (e) { lastErr = e; }
  }
  throw new DomainError("VALIDATION", `所有上游源下载失败：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`, null);
}

/** 在线更新：下载 → 校验 → 原子替换 → 重建搜索器。手动按钮与调度共用 */
export async function updateIpGeoData(): Promise<{ ok: true; bytes: number }> {
  const { bytes } = await fetchXdb();
  mkdirSync(IPGEO_DIR, { recursive: true });
  const tmp = join(IPGEO_DIR, `ip2region.${Date.now()}.tmp`);
  writeFileSync(tmp, bytes);
  try {
    // 用下载文件真实建一个搜索器并试查，坏包直接拒绝
    const { newWithFileOnly } = await import("ip2region-ts");
    const probe = (await newWithFileOnly(tmp)) as unknown as XdbSearcher;
    const r = await probe.search("1.2.3.4");
    if (!r?.region || r.region.split("|").length < 5) throw new Error("校验查询返回异常");
  } catch (e) {
    try { renameSync(tmp, `${tmp}.bad`); } catch { /* 清理失败无所谓 */ }
    throw new DomainError("VALIDATION", `下载的数据未通过校验：${e instanceof Error ? e.message : String(e)}`, null);
  }
  renameSync(tmp, CUSTOM_XDB);
  searcherPromise = null;   // 强制下次查询重建（加载新文件）
  searcherSource = null;
  await getSearcher();      // ⚠️ 必须等待：否则立即返回的 status 会读到"未加载"的中间态
  const meta = readMeta();
  writeMeta({ ...meta, lastUpdateAt: new Date().toISOString(), lastCheckAt: new Date().toISOString() });
  return { ok: true, bytes: bytes.length };
}

/** 调度入口：距上次检查超过 intervalMs 才真正拉取；失败只记录不抛出（不打断服务） */
export async function checkIpGeoData(intervalMs: number): Promise<{ checked: boolean; updated?: boolean; reason?: string }> {
  const meta = readMeta();
  const last = meta.lastCheckAt ? Date.parse(meta.lastCheckAt) : 0;
  if (Date.now() - last < intervalMs) return { checked: false, reason: "未到检查周期" };
  writeMeta({ ...meta, lastCheckAt: new Date().toISOString() });
  try {
    const r = await updateIpGeoData();
    return { checked: true, updated: true, reason: `${r.bytes} bytes` };
  } catch (e) {
    return { checked: true, updated: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
