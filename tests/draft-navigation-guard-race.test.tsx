import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DraftNavigationGuard } from "../src/client/components/ui/DraftNavigationGuard.tsx";

const hooks = vi.hoisted(() => ({
  blockers: [] as Array<{ shouldBlockFn: () => Promise<boolean> }>,
  confirm: vi.fn(async (_message: string) => true),
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({}),
  useBlocker: (options: { shouldBlockFn: () => Promise<boolean> }) => hooks.blockers.push(options),
}));
vi.mock("../src/client/components/Dialog.tsx", () => ({ confirmDialog: hooks.confirm }));
afterEach(() => { cleanup(); hooks.blockers.length = 0; hooks.confirm.mockClear(); });

it("保存结束后立即导航，即使路由尚未移除旧拦截器也不会误拦截", async () => {
  const { rerender } = render(<DraftNavigationGuard dirty saving message="未保存" />);
  const previous = hooks.blockers[0]!;
  await expect(previous.shouldBlockFn()).resolves.toBe(true);
  rerender(<DraftNavigationGuard dirty={false} saving={false} message="未保存" />);
  await expect(previous.shouldBlockFn()).resolves.toBe(false);
  expect(hooks.confirm).not.toHaveBeenCalled();
});

it("旧拦截器读取当前的草稿状态和提示，保存开始后不再弹确认框", async () => {
  const { rerender } = render(<DraftNavigationGuard dirty saving={false} message="旧提示" />);
  const previous = hooks.blockers[0]!;
  rerender(<DraftNavigationGuard dirty saving={false} message="当前草稿" />);
  await expect(previous.shouldBlockFn()).resolves.toBe(false);
  expect(hooks.confirm).toHaveBeenCalledWith("当前草稿");
  hooks.confirm.mockClear();
  rerender(<DraftNavigationGuard dirty saving message="正在保存" />);
  await expect(previous.shouldBlockFn()).resolves.toBe(true);
  expect(hooks.confirm).not.toHaveBeenCalled();
});
