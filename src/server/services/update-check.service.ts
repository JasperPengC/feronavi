/**
 * 平台更新检查（自托管实例的"有新版"提示）
 *
 * 真相源：GitHub Releases（仓库由 FERONAVI_UPDATE_REPO 配置，如 "feronavi/feronavi"；
 * 未配置 = 功能未启用，系统页如实显示"未配置更新源"）。
 * 结果缓存 24h（DATA_DIR/update-check.json），手动"立即检查"可强制刷新。
 * 只做**信息提示**，绝不自动升级 —— 升级是管理员在服务器上的显式动作。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = process.env.DATA_DIR;
const STATE_FILE = DATA_DIR ? join(DATA_DIR, "update-check.json") : "/data/update-check.json";
const REPO = process.env.FERONAVI_UPDATE_REPO ?? "";
const CHECK_INTERVAL_MS = 24 * 3_600_000;

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "../../../package.json");

function currentVersion(): string {
  try { return (JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string }).version ?? "0.0.0"; } catch { return "0.0.0"; }
}

interface CheckState { checkedAt: string; current: string; latest: string | null; releaseUrl: string | null; hasUpdate: boolean; error?: string }

function readState(): CheckState | null {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")) as CheckState; } catch { return null; }
}

function writeState(state: CheckState): void {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch { /* 状态持久化失败不影响检查本身 */ }
}

/** 语义化比较：按数字段逐段比，段数不齐补 0；非数字段按字符串兜底 */
function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/i, "").split(/[.+-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  const a = parse(candidate), b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x > y;
    return String(x) > String(y);
  }
  return false;
}

export interface PlatformUpdateStatus {
  configured: boolean;
  current: string;
  latest: string | null;
  releaseUrl: string | null;
  hasUpdate: boolean;
  checkedAt: string | null;
  error: string | null;
}

async function fetchLatest(): Promise<{ latest: string; releaseUrl: string | null }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      signal: ctl.signal,
      headers: { accept: "application/vnd.github+json", "user-agent": "feronavi-update-check" },
    });
    if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
    const data = (await res.json()) as { tag_name?: string; html_url?: string };
    if (!data.tag_name) throw new Error("响应缺少 tag_name");
    return { latest: data.tag_name, releaseUrl: data.html_url ?? null };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkPlatformUpdate(force = false): Promise<PlatformUpdateStatus> {
  const current = currentVersion();
  if (!REPO) {
    return { configured: false, current, latest: null, releaseUrl: null, hasUpdate: false, checkedAt: null, error: null };
  }
  const cached = readState();
  if (!force && cached && cached.current === current && Date.now() - Date.parse(cached.checkedAt) < CHECK_INTERVAL_MS) {
    return { configured: true, current, latest: cached.latest, releaseUrl: cached.releaseUrl, hasUpdate: cached.hasUpdate, checkedAt: cached.checkedAt, error: cached.error ?? null };
  }
  let state: CheckState;
  try {
    const { latest, releaseUrl } = await fetchLatest();
    state = { checkedAt: new Date().toISOString(), current, latest, releaseUrl, hasUpdate: isNewerVersion(latest, current) };
  } catch (e) {
    state = { ...(cached ?? { checkedAt: new Date().toISOString(), current, latest: null, releaseUrl: null, hasUpdate: false }), checkedAt: new Date().toISOString(), current, error: e instanceof Error ? e.message : String(e) };
  }
  writeState(state);
  return { configured: true, current, latest: state.latest, releaseUrl: state.releaseUrl, hasUpdate: state.hasUpdate, checkedAt: state.checkedAt, error: state.error ?? null };
}

export function platformUpdateStatus(): PlatformUpdateStatus {
  const current = currentVersion();
  if (!REPO) return { configured: false, current, latest: null, releaseUrl: null, hasUpdate: false, checkedAt: null, error: null };
  const cached = readState();
  return {
    configured: true, current,
    latest: cached?.latest ?? null, releaseUrl: cached?.releaseUrl ?? null,
    hasUpdate: cached?.hasUpdate ?? false,
    checkedAt: cached?.checkedAt ?? null,
    error: cached?.error ?? null,
  };
}
