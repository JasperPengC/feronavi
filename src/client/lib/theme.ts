/**
 * 主题控制器（S2）
 *
 * 与 index.html 的防 FOUC 内联脚本**共用同一个 cookie**（`feronavi_theme`）：
 * 启动时由内联脚本写入 <html class>，运行时的切换由这里负责持久化 + 应用。
 * 二者读同一个键，保证刷新后不闪。
 *
 * ⚠️ 服务端偏好值域是 `system | light | dark`（member_preference.theme），
 * 客户端历史值域是 `auto | light | dark`。两者**必须先归一化**：
 * 旧实现把服务端 `"system"` 直接当客户端值传给 applyTheme，判断
 * `choice === "auto" && prefersDark()` 永远为 false → 选了「跟随系统」却强制浅色。
 */
export type ThemeChoice = "auto" | "light" | "dark";
/** 服务端允许的值域（system 是客户端的 auto） */
export type ServerThemeChoice = "system" | "light" | "dark";

const COOKIE = "feronavi_theme";

/** 任意历史/服务端取值 → 客户端值域（未知值按 auto） */
export function normalizeTheme(value: string | null | undefined): ThemeChoice {
  return value === "dark" ? "dark" : value === "light" ? "light" : "auto";
}

export function readTheme(): ThemeChoice {
  const m = /(?:^|;\s*)feronavi_theme=([^;]+)/.exec(document.cookie);
  return normalizeTheme(m ? decodeURIComponent(m[1]!) : "auto");
}

function prefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** 把选择应用到 <html class>（与内联脚本同一套类名）；接受服务端 "system" */
export function applyTheme(choice: ThemeChoice | ServerThemeChoice | string): void {
  const normalized = normalizeTheme(choice);
  const dark = normalized === "dark" || (normalized === "auto" && prefersDark());
  document.documentElement.className = dark ? "theme-dark" : "theme-light";
}

export function setTheme(choice: ThemeChoice | ServerThemeChoice | string): void {
  const normalized = normalizeTheme(choice);
  // 一年有效；SameSite=Lax 与登录 cookie 同风格。**cookie 只写客户端值域 auto**，
  // 避免旧的 "system" 再被内联脚本误判成浅色。
  document.cookie = `${COOKIE}=${normalized}; path=/; max-age=31536000; samesite=lax`;
  applyTheme(normalized);
}

/** 当前**生效**的主题（auto 时解析系统偏好）—— 界面要能告诉用户"现在实际是什么" */
export function effectiveTheme(): "light" | "dark" {
  const choice = readTheme();
  if (choice === "dark" || choice === "light") return choice;
  return prefersDark() ? "dark" : "light";
}

/**
 * auto 模式下跟随系统变化实时切换。
 *
 * ⚠️ 两个曾经的真实缺陷：
 *   1 监听原先只注册在 `ThemeToggle` 组件内 —— 组件不挂载（或换页卸载）时就完全不跟随系统；
 *      现在由**应用级**调用一次（见 main.tsx），与组件生命周期解耦。
 *   2 只用了 `addEventListener`；老 Safari（<14）的 MediaQueryList **只有 `addListener`**，
 *      `?.()` 会**静默不注册** —— 表现为"选了跟随系统但永远不跟着变"。两条路径都要走。
 */
export function watchSystemTheme(onChange?: (t: "light" | "dark") => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    if (readTheme() !== "auto") return;
    applyTheme("auto");
    onChange?.(prefersDark() ? "dark" : "light");
  };
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }
  // 兼容旧实现（Safari < 14 / 部分 WebView）
  const legacy = mq as MediaQueryList & {
    addListener?: (cb: () => void) => void; removeListener?: (cb: () => void) => void;
  };
  legacy.addListener?.(handler);
  return () => legacy.removeListener?.(handler);
}
