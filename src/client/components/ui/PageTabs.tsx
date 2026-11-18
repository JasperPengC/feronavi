import { useEffect, useRef, useState, type ReactNode } from "react";

export function PageTabs<T extends string>({ id, label, tabs, value, onChange, className = "" }: {
  id: string;
  label: string;
  tabs: readonly { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  return <div ref={list} className={`page-tabbar page-tabs ${className}`} role="tablist" aria-label={label}>
    {tabs.map(tab => <button key={tab.value} type="button" role="tab" className="page-tab"
      id={`${id}-tab-${tab.value}`} aria-controls={`${id}-panel-${tab.value}`}
      aria-selected={value === tab.value} data-active={value === tab.value} tabIndex={value === tab.value ? 0 : -1}
      disabled={tab.disabled} onClick={() => { if (tab.value !== value) onChange(tab.value); }}
      onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const enabled = tabs.filter(item => !item.disabled);
        const current = enabled.findIndex(item => item.value === tab.value);
        const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length;
        const target = enabled[next];
        if (!target || target.value === value) return;
        onChange(target.value);
        const button = list.current?.querySelector<HTMLButtonElement>(`[id="${id}-tab-${target.value}"]`);
        button?.focus();
        button?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      }}>{tab.label}</button>)}
  </div>;
}

/** 首次访问才挂载；切换时保留已访问内容，避免表单、上传和筛选状态丢失。 */
export function TabPanel({ tabsId, value, activeValue, children, className = "" }: {
  tabsId: string; value: string; activeValue: string; children: ReactNode | (() => ReactNode); className?: string;
}) {
  const active = value === activeValue;
  const [visited, setVisited] = useState(active);
  useEffect(() => { if (active && !visited) setVisited(true); }, [active, visited]);
  return <section id={`${tabsId}-panel-${value}`} role="tabpanel" aria-labelledby={`${tabsId}-tab-${value}`}
    tabIndex={0} hidden={!active} className={`page-tab-panel ${className}`}>
    {(active || visited) && (typeof children === "function" ? children() : children)}
  </section>;
}
