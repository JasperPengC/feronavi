import { useEffect, useId, useRef, useState } from "react";
import { Icon, type IconName } from "../Icon.tsx";
import { Button } from "./Button.tsx";

/** 语言、主题等单选菜单，共用焦点和键盘行为。 */
export function IconChoiceMenu<T extends string>({ label, icon, value, options, onChange, className = "" }: {
  label: string;
  icon: IconName;
  value: T;
  options: readonly { value: T; label: string; icon?: IconName }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const boxRef = useRef<HTMLDivElement | null>(null);

  function closeAndFocus() {
    setOpen(false);
    boxRef.current?.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")?.focus();
  }

  useEffect(() => {
    if (!open) return;
    boxRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
    const onDown = (event: PointerEvent) => { if (!boxRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div className={`icon-choice-menu ${className}`} ref={boxRef}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onKeyDown={(event) => {
        if (!open) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeAndFocus(); }
        if (event.key === "Tab") closeAndFocus();
      }}>
      <Button size="sm" iconOnly aria-label={label} aria-haspopup="menu" aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={`${label} · ${options.find((option) => option.value === value)?.label ?? ""}`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
        }}>
        <Icon name={icon} />
      </Button>
      {open && (
        <div id={menuId} className="menu-panel" role="menu" aria-label={label}
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
          }}>
          {options.map((option) => (
            <button key={option.value} type="button" role="menuitemradio" tabIndex={-1}
              aria-checked={value === option.value} className="menu-item"
              onClick={() => { onChange(option.value); closeAndFocus(); }}>
              {option.icon && <Icon name={option.icon} />}
              <span className="menu-item-label">{option.label}</span>
              {value === option.value && <Icon name="check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
