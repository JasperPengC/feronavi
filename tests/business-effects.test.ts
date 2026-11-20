import { beforeEach, expect, it, vi } from "vitest";
beforeEach(() => vi.resetModules());
it("未装配的跨域行为明确失败，不能静默丢失自动化或审批", async () => {
  const { businessEffects } = await import("../src/server/services/business-effects.ts");
  expect(() => businessEffects()).toThrow("application root");
});
it("领域端口保持参数、返回值与错误，不隐式扩大权限", async () => {
  const { businessEffects, installBusinessEffects } = await import("../src/server/services/business-effects.ts");
  const automation = vi.fn(async () => {});
  const effects = {
    runAutomation: automation,
    ensureSla: vi.fn(async () => {}),
    markFirstResponse: vi.fn(async () => {}),
    markTransition: vi.fn(async () => {}),
    requestApproval: vi.fn(async () => { throw new Error("forbidden"); }),
    deliverWebhook: vi.fn(async () => ({ queued: true })),
    synchronizePublishedPage: vi.fn(async () => null),
    finishPagePublication: vi.fn(async () => ({ status: "QUEUED" as const })),
  };
  installBusinessEffects(effects);
  await businessEffects().runAutomation("WORK_ITEM_CREATED", "item-id");
  expect(automation).toHaveBeenCalledExactlyOnceWith("WORK_ITEM_CREATED", "item-id");
  await businessEffects().deliverWebhook("work_item.created", { id: "item-id" }, "project-id");
  expect(effects.deliverWebhook).toHaveBeenCalledExactlyOnceWith("work_item.created", { id: "item-id" }, "project-id");
  await expect(businessEffects().requestApproval({} as never, {} as never, {} as never)).rejects.toThrow("forbidden");
});
