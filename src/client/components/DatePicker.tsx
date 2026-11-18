/**
 * 系统自绘日期选择器（替代 <input type="date">）—— 外壳重做第 8 轮，用户要求第 4 条。
 *
 * 为什么必须自绘：原生日期框的外观由**浏览器与操作系统**决定（同一页面在不同平台长得不一样），
 * 深色主题下还会闪白底，且它在用户截图里就是那个「年/月/日」的空框 —— 与本系统风格割裂。
 *
 * 自己实现就必须把**键盘与语义**补齐：
 *   · 触发器：按钮（不是输入框），显示本地化日期，`aria-haspopup="dialog"`
 *   · 弹层：`role="dialog"` + 月历；每一天是按钮，带 `aria-label`（读屏需要"2026年10月17日"而非"17"）
 *   · 键盘：Esc 关；← → 移动一天；↑ ↓ 移动一周；PageUp/PageDown 换月；Enter 选中；Home 回今天
 *   · 今天：`aria-current="date"`；选中：`aria-pressed`
 * 值一律用 **本地日期** 计算（避免 toISOString 的 UTC 偏移把 10 月 17 日变成 10 月 16 日）。
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon.tsx";
import { Button } from "./ui/Button.tsx";
import { Field } from "./ui/Field.tsx";
import { currentLocale } from "../i18n/index.ts";

const pad = (n: number) => String(n).padStart(2, "0");
/** 本地日期 → YYYY-MM-DD（**不用 toISOString**：那是 UTC，会把日期整体挪一天） */
export const toISODate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromISODate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

export function DatePicker({
  value, onChange, ariaLabel, placeholder, clearable = true,
  label, hint, error, required, id, disabled = false, invalid = false,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  placeholder?: string;
  clearable?: boolean;
  /** 可见标签（与 TextInput 同一套 .field 语义）；不传则维持原样 */
  label?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  id?: string;
  disabled?: boolean;
  /** 组合控件把外层错误态传进来用；不传时由 error 推导 */
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const sel = fromISODate(value);
  const today = new Date();
  const [cursor, setCursor] = useState<Date>(sel ?? today);   // 当前显示/聚焦的日期
  const [view, setView] = useState<Date>(sel ?? today);       // 当前显示的月份
  const boxRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const updatePanelPos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const panelWidth = Math.min(320, window.innerWidth - 16);
    const estimatedHeight = 280;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - panelWidth - 8));
    const top = rect.bottom + estimatedHeight + 8 > window.innerHeight
      ? Math.max(8, rect.top - estimatedHeight - 6)
      : rect.bottom + 6;
    setPanelPos({ top, left });
  }, []);

  useEffect(() => { if (open) { const d = sel ?? today; setCursor(d); setView(d); } }, [open]);

  useEffect(() => {
    if (!open) return;
    updatePanelPos();
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (boxRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onViewport = () => updatePanelPos();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onViewport);
    window.addEventListener("scroll", onViewport, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onViewport);
      window.removeEventListener("scroll", onViewport, true);
    };
  }, [open, updatePanelPos]);

  const fmt = (d: Date) =>
    d.toLocaleDateString(currentLocale(), { year: "numeric", month: "2-digit", day: "2-digit" });

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  function move(days: number) {
    const d = new Date(cursor); d.setDate(d.getDate() + days); setCursor(d); setView(d);
  }
  function moveMonth(delta: number) {
    const d = new Date(view); d.setMonth(d.getMonth() + delta); setView(d);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home"].includes(e.key)) {
      e.preventDefault();
      if (e.key === "ArrowLeft") move(-1);
      else if (e.key === "ArrowRight") move(1);
      else if (e.key === "ArrowUp") move(-7);
      else if (e.key === "ArrowDown") move(7);
      else if (e.key === "PageUp") moveMonth(-1);
      else if (e.key === "PageDown") moveMonth(1);
      else { setCursor(today); setView(today); }
      return;
    }
    if ((e.key === "Enter" || e.key === " ") && open) { e.preventDefault(); onChange(toISODate(cursor)); setOpen(false); }
  }

  // 月历格子：从当月起 6 周（固定 42 格，避免高度跳动）
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));   // 周一为一周起点
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const weekdays = ["一", "二", "三", "四", "五", "六", "日"];

  const autoId = useId();
  const controlId = id ?? autoId;
  const labelId = label !== undefined ? `${controlId}-label` : undefined;
  const descId = hint !== undefined || error !== undefined ? `${controlId}-desc` : undefined;
  const hasError = error !== undefined && error !== null && error !== "";
  const wrap = label !== undefined || hint !== undefined || error !== undefined;

  const control = (
    <div className="datepicker" ref={boxRef}>
      <button
        id={controlId}
        ref={triggerRef}
        type="button"
        className="btn btn-ghost datepicker-trigger"
        aria-label={label !== undefined ? undefined : ariaLabel}
        aria-labelledby={labelId}
        aria-describedby={descId}
        aria-invalid={hasError || invalid || undefined}
        aria-required={required || undefined}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
      >
        <Icon name="calendar" />
        <span className="datepicker-value">{sel ? fmt(sel) : (placeholder ?? "")}</span>
      </button>
      {open && createPortal((
        <div ref={panelRef} className="menu-panel datepicker-panel datepicker-panel--floating" role="dialog" aria-label={ariaLabel}
          onKeyDown={onKeyDown} tabIndex={-1}
          style={{ position: "fixed", top: panelPos.top, left: panelPos.left, zIndex: 3000 }}>
          <div className="datepicker-head">
            <Button size="sm" iconOnly aria-label="上个月" onClick={() => moveMonth(-1)}>
              <Icon name="chevron-left" />
            </Button>
            <strong aria-live="polite">
              {view.toLocaleDateString(currentLocale(), { year: "numeric", month: "long" })}
            </strong>
            <Button size="sm" iconOnly aria-label="下个月" onClick={() => moveMonth(1)}>
              <Icon name="chevron-right" />
            </Button>
            {clearable && (
              <Button size="sm" variant="ghost" onClick={() => { onChange(""); setOpen(false); }}>
                清除
              </Button>
            )}
          </div>
          <div className="datepicker-week" aria-hidden="true">
            {weekdays.map((w) => <span key={w}>{w}</span>)}
          </div>
          <div className="datepicker-grid">
            {cells.map((d) => {
              const isSel = sel ? sameDay(d, sel) : false;
              const isToday = sameDay(d, today);
              const outside = d.getMonth() !== view.getMonth();
              return (
                <button
                  key={toISODate(d)}
                  type="button"
                  className="datepicker-day"
                  data-outside={outside ? "true" : "false"}
                  data-cursor={sameDay(d, cursor) ? "true" : "false"}
                  aria-pressed={isSel}
                  aria-current={isToday ? "date" : undefined}
                  aria-label={d.toLocaleDateString(currentLocale(), { year: "numeric", month: "long", day: "numeric" })}
                  onClick={() => { onChange(toISODate(d)); setOpen(false); }}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      ), triggerRef.current?.closest(".ui-drawer-scrim")?.querySelector(".ui-drawer-popovers") ?? document.body)}
    </div>
  );

  // 无 label/hint/error 时**不改变原有 DOM**
  if (!wrap) return control;
  return (
    <Field label={label} hint={hint} error={error} required={required}
      htmlFor={label !== undefined ? controlId : undefined} labelId={labelId} descId={descId}>
      {control}
    </Field>
  );
}
