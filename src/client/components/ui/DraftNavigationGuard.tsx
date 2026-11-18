import { useBlocker, useRouter } from "@tanstack/react-router";
import { confirmDialog } from "../Dialog.tsx";

interface Props { dirty: boolean; saving: boolean; message: string }

function RouterDraftGuard({ dirty, saving, message }: Props) {
  useBlocker({
    disabled: !dirty && !saving,
    enableBeforeUnload: dirty || saving,
    shouldBlockFn: async () => saving || !(await confirmDialog(message)),
  });
  return null;
}

/** 抽屉也要保护浏览器返回、站内跳转与刷新；独立嵌入场景可没有路由上下文。 */
export function DraftNavigationGuard(props: Props) {
  const router = useRouter({ warn: false });
  return router ? <RouterDraftGuard {...props} /> : null;
}
