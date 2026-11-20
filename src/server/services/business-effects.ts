/** Typed domain ports. The application root supplies cross-domain orchestration. */
import type { runAutomation } from "./automation.service.ts";
import type { ensureSla, markFirstResponse, markTransition } from "./sla.service.ts";
import type { requestApproval } from "./approval.service.ts";
import type { synchronizePublishedPage, finishPagePublication } from "./collab-document.service.ts";
export interface BusinessEffects {
  runAutomation: typeof runAutomation;
  ensureSla: typeof ensureSla;
  markFirstResponse: typeof markFirstResponse;
  markTransition: typeof markTransition;
  requestApproval: typeof requestApproval;
  synchronizePublishedPage: typeof synchronizePublishedPage;
  finishPagePublication: typeof finishPagePublication;
  deliverWebhook(event: string, payload: Record<string, unknown>, projectId: string | null): Promise<unknown>;
}
let installed: BusinessEffects | undefined;
export function installBusinessEffects(effects: BusinessEffects): void {
  installed = effects;
}
export function businessEffects(): BusinessEffects {
  if (!installed) throw new Error("Business effects must be installed by the application root");
  return installed;
}
