/**
 * 系统自绘对话框（替代原生 confirm / alert / prompt）—— 外壳重做第 17 轮，用户要求第 4 条。
 *
 * 为什么必须替换：原生 `confirm/prompt` 是**浏览器模态**（样式不可控、深色主题下闪白、会阻塞主线程），
 * 且 `prompt` 在部分嵌入式 WebView 里被禁用。自绘后外观、按钮体系、动效守卫都归本系统。
 *
 * 设计取舍：**不用 React Context**，改用模块级队列 + 订阅 —— 这样调用方不需要 Provider，
 * 也避免"外壳里加 Provider 导致既有测试全红"这类问题（本会话已踩过一次）。
 *
 * 用法：`if (await confirmDialog(msg)) …` / `const name = await promptDialog(msg, def)`
 * 无障碍：弹层 `role="dialog"` + `aria-modal`，打开即聚焦输入/主按钮，Esc 取消，Enter 确认。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./ui/Button.tsx";
import { t } from "../i18n/index.ts";

type Req =
  | { kind: "confirm"; message: string; danger?: boolean; resolve: (v: boolean) => void }
  | { kind: "prompt"; message: string; defaultValue: string; resolve: (v: string | null) => void };

let queue: Req[] = [];
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

export function confirmDialog(message: string, opts?: { danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => { queue = [...queue, { kind: "confirm", message, danger: opts?.danger, resolve }]; notify(); });
}
export function promptDialog(message: string, defaultValue = ""): Promise<string | null> {
  return new Promise((resolve) => { queue = [...queue, { kind: "prompt", message, defaultValue, resolve }]; notify(); });
}

export function DialogHost() {
  const [req, setReq] = useState<Req | null>(null);
  const [text, setText] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const tick = () => setReq(queue[0] ?? null);
    subs.add(tick); tick();
    return () => { subs.delete(tick); };
  }, []);

  useEffect(() => { if (req?.kind === "prompt") setText(req.defaultValue); }, [req]);

  // 打开后聚焦：有输入框聚焦输入框，否则聚焦主按钮（键盘用户不用先 Tab 找）
  useEffect(() => {
    if (!req) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = boxRef.current?.querySelector<HTMLElement>("[data-autofocus]");
    el?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [req]);

  if (!req) return null;

  const done = (v: boolean | string | null) => {
    queue = queue.slice(1);
    if (req.kind === "confirm") req.resolve(v as boolean);
    else req.resolve(v as string | null);
    notify();
  };

  return createPortal(
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) done(req.kind === "confirm" ? false : null); }}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={req.message}
        ref={boxRef}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(req.kind === "confirm" ? false : null); }
          if (e.key === "Enter" && req.kind === "prompt") { e.preventDefault(); done(text); }
          if (e.key === "Tab") {
            const controls = boxRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled])');
            const first = controls?.[0], last = controls?.[controls.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
          }
        }}
      >
        <p className="modal-message">{req.message}</p>
        {req.kind === "prompt" && (
          <input className="input" style={{ width: "100%" }} value={text} data-autofocus
            aria-label={req.message} onChange={(e) => setText(e.target.value)} />
        )}
        <div className="modal-actions">
          <Button onClick={() => done(req.kind === "confirm" ? false : null)}>{t("common.cancel")}</Button>
          <Button variant={req.kind === "confirm" && req.danger ? "danger" : "primary"} data-autofocus={req.kind === "confirm" ? "" : undefined}
            onClick={() => done(req.kind === "confirm" ? true : text)}>{t("common.confirm")}</Button>
        </div>
      </div>
    </div>, document.body,
  );
}
