import { createContext, useCallback, useContext, useId, useLayoutEffect, useRef, useState } from "react";
import { confirmDialog } from "../Dialog.tsx";
import { t } from "../../i18n/index.ts";

type DraftState = { dirty: boolean; saving: boolean };
type Register = (id: string, state: DraftState | null) => void;
export const LocalDraftContext = createContext<Register | null>(null);

/** 详情内导航不经过路由，用同一份表单状态保护返回、跳转和关闭。 */
export function useLocalDraftScope() {
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const confirming = useRef(false);
  const register = useCallback<Register>((id, state) => setDrafts(current => {
    if (state && current[id]?.dirty === state.dirty && current[id]?.saving === state.saving) return current;
    if (!state && !current[id]) return current;
    const next = { ...current };
    if (state) next[id] = state; else delete next[id];
    return next;
  }), []);
  const dirty = Object.values(drafts).some(value => value.dirty);
  const saving = Object.values(drafts).some(value => value.saving);
  const leave = async (action: () => void) => {
    if (saving || confirming.current) return;
    confirming.current = true;
    try { if (!dirty || await confirmDialog(t("flows.discardDraft"))) action(); }
    finally { confirming.current = false; }
  };
  return { register, dirty, saving, leave };
}

export function useLocalDraft(dirty: boolean, saving = false) {
  const register = useContext(LocalDraftContext), id = useId();
  useLayoutEffect(() => { register?.(id, { dirty, saving }); }, [register, id, dirty, saving]);
  useLayoutEffect(() => () => register?.(id, null), [register, id]);
}
