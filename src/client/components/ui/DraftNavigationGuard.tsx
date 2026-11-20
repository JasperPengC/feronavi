import { useBlocker, useRouter } from "@tanstack/react-router";
import { useLayoutEffect, useRef } from "react";
import { confirmDialog } from "../Dialog.tsx";

interface Props { dirty: boolean; saving: boolean; message: string }

function RouterDraftGuard({ dirty, saving, message }: Props) {
  const current = useRef({ dirty, saving, message });
  // 路由在普通effect中替换拦截器；页面提交后的即时导航必须读取本次提交的状态。
  useLayoutEffect(() => { current.current = { dirty, saving, message }; }, [dirty, saving, message]);
  useBlocker({
    disabled: !dirty && !saving,
    enableBeforeUnload: dirty || saving,
    shouldBlockFn: async () => {
      const state = current.current;
      if (state.saving) return true;
      if (!state.dirty) return false;
      return !(await confirmDialog(state.message));
    },
  });
  return null;
}

/** 抽屉也要保护浏览器返回、站内跳转与刷新；独立嵌入场景可没有路由上下文。 */
export function DraftNavigationGuard(props: Props) {
  const router = useRouter({ warn: false });
  return router ? <RouterDraftGuard {...props} /> : null;
}
