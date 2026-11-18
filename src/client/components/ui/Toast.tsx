import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "../Icon.tsx";
import { t } from "../../i18n/index.ts";

type ToastKind = "success" | "error" | "info";
interface ToastItem { id: number; kind: ToastKind; message: ReactNode; }
const listeners = new Set<(items: ToastItem[]) => void>();
let items: ToastItem[] = [];
let nextId = 1;

function emit() { listeners.forEach((listener) => listener(items)); }
function remove(id: number) { items = items.filter((item) => item.id !== id); emit(); }
function push(kind: ToastKind, message: ReactNode) {
  const id = nextId++;
  items = [...items, { id, kind, message }];
  emit();
  window.setTimeout(() => remove(id), 4200);
}

export const toast = {
  success: (message: ReactNode) => push("success", message),
  error: (message: ReactNode) => push("error", message),
  info: (message: ReactNode) => push("info", message),
};

export function ToastHost() {
  const [current, setCurrent] = useState<ToastItem[]>(items);
  useEffect(() => { listeners.add(setCurrent); return () => { listeners.delete(setCurrent); }; }, []);
  return (
    <div className="ui-toast-host" aria-live="polite" aria-atomic="true">
      {current.map((item) => (
        <div key={item.id} className={`ui-toast ui-toast-${item.kind}`} role={item.kind === "error" ? "alert" : "status"}>
          <Icon name={item.kind === "success" ? "check" : item.kind === "error" ? "x" : "info"} />
          <span>{item.message}</span>
          <button type="button" className="ui-toast-close" aria-label={t("common.close")} onClick={() => remove(item.id)}>
            <Icon name="x" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
