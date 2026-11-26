/**
 * 共享下拉：支持搜索、键盘选择、视口定位和模态内浮层。
 *   · Enter/Space/↓ 打开；↑↓ 移动；Enter 选中；Esc 关闭；点击外部关闭
 *   · 语义用 `listbox` + `option` + `aria-selected`（不是 menu —— 单选列表的正确角色）
 *   · 触发器带 `aria-haspopup="listbox"` / `aria-expanded`
 * 复用 .menu-panel/.menu-item 与按钮体系，因此外观天然与主题下拉一致。
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon.tsx";
import { t } from "../i18n/index.ts";
import { Field } from "./ui/Field.tsx";

export interface SelectOption { value: string; label: string; secondaryLabel?: string }

export function Select({
  value, options, onChange, ariaLabel, size = "md", disabled, placeholder,
  label, hint, error, required, id, className = "", invalid = false, searchable = false,
  description, minPanelWidth = 168, leadingIcon, onSearchChange, selectedOption, searchStatus,
}: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  ariaLabel: string;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  placeholder?: string;
  /** 可见标签（与 TextInput 同一套 .field 语义）；不传则维持原样（工具栏 / 筛选器常用） */
  label?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  id?: string;
  /** 外层 .field 的附加类名（只在传了 label/hint/error 时生效） */
  className?: string;
  /** 组合控件把外层错误态传进来用；不传时由 error 推导 */
  invalid?: boolean;
  /** 可搜索：面板顶部带过滤输入框（选项很多时用，如时区全量 IANA 列表） */
  searchable?: boolean;
  /** 仅在展开时呈现的上下文说明。 */
  description?: string;
  minPanelWidth?: number;
  /** 与文字共用点击和聚焦区域的装饰图标。 */
  leadingIcon?: React.ReactNode;
  /** 远程检索交给调用方；不再对服务端结果重复做本地过滤。 */
  onSearchChange?: (query: string) => void;
  selectedOption?: SelectOption;
  searchStatus?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 168, maxHeight: 312, above: false });
  const listId = useId();
  /** 搜索模式下用于渲染与键盘导航的过滤结果 */
  const filtered = useMemo(() => {
    const choices = placeholder ? options.filter((option) => option.value !== "") : options;
    if (!searchable || onSearchChange) return choices;
    const q = query.trim().toLowerCase();
    if (!q) return choices;
    return choices.filter((o) => `${o.value} ${o.label} ${o.secondaryLabel ?? ""}`.toLowerCase().includes(q));
  }, [options, query, searchable, placeholder, onSearchChange]);

  useEffect(() => {
    if (!open) return;
    const outside = (target: EventTarget | null) => !boxRef.current?.contains(target as Node) && !panelRef.current?.contains(target as Node);
    const onDown = (e: PointerEvent) => { if (outside(e.target)) setOpen(false); };
    const onFocus = (e: FocusEvent) => { if (outside(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("focusin", onFocus);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("focusin", onFocus); };
  }, [open]);

  const current = options.find((o) => o.value === value) ?? (selectedOption?.value === value ? selectedOption : undefined);
  const activeIndex = Math.max(0, Math.min(active, filtered.length - 1));

  function commit(o: SelectOption | undefined) {
    if (!o) return;
    onChange(o.value);
    close();
  }

  function close() {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  function show() {
    setQuery("");
    onSearchChange?.("");
    setActive(Math.max(0, filtered.findIndex(option => option.value === value)));
    setOpen(true);
  }

  // Portal 不继承 fieldset 的禁用状态；提交中同步关闭选项。
  useLayoutEffect(() => {
    if (open && triggerRef.current?.matches(":disabled")) setOpen(false);
  });

  useLayoutEffect(() => {
    if (!open) return;
    (searchable ? searchRef.current : listRef.current)?.focus({ preventScroll: true });
  }, [open, searchable]);

  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const option = list?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    if (!list || !option) return;
    // 只滚动选项列表，不能带动页面或抽屉。
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
    }
  }, [open, activeIndex, filtered, position.maxHeight, position.width]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const trigger = triggerRef.current, panel = panelRef.current;
      if (!trigger || !panel) return;
      const rect = trigger.getBoundingClientRect(), viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
      const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0;
      const below = Math.max(0, height + y - rect.bottom - 14), above = Math.max(0, rect.top - y - 14);
      const searchHeight = panel.querySelector<HTMLElement>(".select-search-row")?.offsetHeight ?? 0;
      const emptyHeight = panel.querySelector<HTMLElement>(".select-empty")?.offsetHeight ?? 0;
      const descriptionHeight = panel.querySelector<HTMLElement>(".select-description")?.offsetHeight ?? 0;
      const desired = Math.min(312, (listRef.current?.scrollHeight ?? 0) + searchHeight + emptyHeight + descriptionHeight + 14);
      const placeAbove = below < desired && above > below;
      const maxHeight = Math.min(312, placeAbove ? above : below);
      const panelWidth = Math.min(Math.max(rect.width, minPanelWidth), width - 16);
      const top = placeAbove ? Math.max(y + 8, rect.top - Math.min(desired, maxHeight) - 6) : rect.bottom + 6;
      const next = { top, left: Math.max(x + 8, Math.min(rect.left, x + width - panelWidth - 8)), width: panelWidth, maxHeight, above: placeAbove };
      setPosition(old => Object.keys(next).every(key => old[key as keyof typeof old] === next[key as keyof typeof next]) ? old : next);
    };
    update();
    const observer = new ResizeObserver(update);
    if (triggerRef.current) observer.observe(triggerRef.current);
    if (panelRef.current) observer.observe(panelRef.current);
    document.addEventListener("animationend", update, true);
    document.addEventListener("transitionend", update, true);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("animationend", update, true);
      document.removeEventListener("transitionend", update, true);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [open, filtered, searchable, description, minPanelWidth]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); show(); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === "Tab") { close(); return; }
    if (e.key === "Home" && e.target !== searchRef.current) { e.preventDefault(); setActive(0); return; }
    if (e.key === "End" && e.target !== searchRef.current) { e.preventDefault(); setActive(filtered.length - 1); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(filtered.length - 1, activeIndex + 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(0, activeIndex - 1)); return; }
    if (e.key === "Enter" || (e.key === " " && e.target !== searchRef.current)) { e.preventDefault(); commit(filtered[activeIndex]); }
  }

  const sizeClass = size === "sm" ? " btn-sm" : size === "lg" ? " btn-lg" : "";
  const autoId = useId();
  const controlId = id ?? autoId;
  const labelId = label !== undefined ? `${controlId}-label` : undefined;
  const descId = hint !== undefined || error !== undefined ? `${controlId}-desc` : undefined;
  const hasError = error !== undefined && error !== null && error !== "";
  const wrap = label !== undefined || hint !== undefined || error !== undefined;
  const activeId = filtered.length ? `${listId}-option-${activeIndex}` : undefined;
  const portal = triggerRef.current?.closest(".ui-drawer-scrim")?.querySelector(".ui-drawer-popovers")
    ?? triggerRef.current?.closest(".ui-modal-scrim, .modal-scrim") ?? document.body;

  const control = (
    <div className="select" ref={boxRef}>
      <button
        id={controlId}
        ref={triggerRef}
        type="button"
        className={`btn btn-ghost select-trigger${sizeClass}`}
        title={current ? [current.label, current.secondaryLabel].filter(Boolean).join(" · ") : undefined}
        aria-label={label !== undefined ? undefined : ariaLabel}
        aria-labelledby={labelId}
        aria-describedby={descId}
        aria-invalid={hasError || invalid || undefined}
        aria-required={required || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => open ? close() : show()}
        onKeyDown={onKeyDown}
      >
        {leadingIcon}
        <span className="select-value" data-placeholder={!current || (placeholder && !value) ? "true" : undefined}>{(placeholder && !value) ? placeholder : current?.label ?? placeholder ?? ""}</span>
        <Icon name="chevron-down" />
      </button>
      {open && createPortal((
        <div ref={panelRef} className="menu-panel select-panel" data-side={position.above ? "top" : "bottom"}
          style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }} onKeyDown={onKeyDown}>
          {description && <p className="select-description" id={`${controlId}-panel-description`}>{description}</p>}
          {searchable && (
            <div className="select-search-row">
              <input
                ref={searchRef}
                role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls={listId} aria-activedescendant={activeId}
                className="select-search"
                aria-label={`${ariaLabel}（${t("common.searchOptions")}）`}
                placeholder={`${t("common.search")}…`}
                value={query}
                onChange={(e) => { setQuery(e.target.value); onSearchChange?.(e.target.value); setActive(0); }}
              />
            </div>
          )}
          <div ref={listRef} className="select-options" id={listId} role="listbox" aria-label={ariaLabel} data-custom-scroll data-scrollbar-scroll-only
            aria-describedby={description ? `${controlId}-panel-description` : undefined}
            tabIndex={searchable ? -1 : 0} aria-activedescendant={searchable ? undefined : activeId}>
          {filtered.map((o, i) => (
            <button
              key={o.value}
              type="button"
              role="option"
              id={`${listId}-option-${i}`} data-index={i} tabIndex={-1}
              aria-selected={o.value === value}
              aria-label={o.secondaryLabel ? `${o.label} ${o.secondaryLabel}` : undefined}
              className="menu-item"
              data-active={i === activeIndex ? "true" : "false"}
              onMouseEnter={() => setActive(i)}
              onClick={() => commit(o)}
            >
              <span className="select-option-copy" title={[o.label, o.secondaryLabel].filter(Boolean).join(" · ")}>
                <span className="select-option-label">{o.label}</span>
                {o.secondaryLabel && <span className="select-option-secondary">{o.secondaryLabel}</span>}
              </span>
              <span className="select-option-check" aria-hidden="true">{o.value === value && <Icon name="check" />}</span>
            </button>
          ))}
          </div>
          {searchStatus && <div className="select-empty" role="status">{searchStatus}</div>}
          {searchable && !searchStatus && filtered.length === 0 && (
            <p className="select-empty">{t("common.noMatches")}</p>
          )}
        </div>
      ), portal)}
    </div>
  );

  // 无 label/hint/error 时**不改变原有 DOM**（工具栏里的筛选下拉外观零变化）
  if (!wrap) return control;
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}
      htmlFor={label !== undefined ? controlId : undefined} labelId={labelId} descId={descId}>
      {control}
    </Field>
  );
}
