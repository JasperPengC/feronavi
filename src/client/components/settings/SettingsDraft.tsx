import { useRef, useState } from "react";
import { t } from "../../i18n/index.ts";
import { confirmDialog } from "../Dialog.tsx";
import { DraftNavigationGuard } from "../ui/DraftNavigationGuard.tsx";

/** 每次打开表单记录起点；刷新查询不会重置用户输入。 */
export function useSettingsDraft(open: boolean, value: unknown, saving: boolean) {
  const serialized = JSON.stringify(value);
  const [initial, setInitial] = useState({ open, value: serialized });
  if (initial.open !== open) setInitial({ open, value: serialized });
  const dirty = open && initial.open && serialized !== initial.value;
  const confirming = useRef(false);
  const leave = async (close: () => void) => {
    if (saving || confirming.current) return;
    confirming.current = true;
    try {
      if (dirty && !await confirmDialog(t("flows.discardDraft"))) return;
      close();
    } finally { confirming.current = false; }
  };
  const markSaved = (nextValue: unknown = value) => setInitial({ open, value: JSON.stringify(nextValue) });
  return { dirty, leave, markSaved, guard: <DraftNavigationGuard dirty={dirty} saving={open && saving} message={t("flows.discardDraft")} /> };
}
