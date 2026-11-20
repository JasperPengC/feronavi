/** Application composition: load implementations before any transaction can emit effects. */
import { installBusinessEffects } from "../services/business-effects.ts";
export async function bootstrapBusinessEffects(): Promise<void> {
  const [automation, sla, approval, webhook, documents] = await Promise.all([
    import("../services/automation.service.ts"),
    import("../services/sla.service.ts"),
    import("../services/approval.service.ts"),
    import("../services/webhook.service.ts"),
    import("../services/collab-document.service.ts"),
  ]);
  installBusinessEffects({
    runAutomation: automation.runAutomation,
    ensureSla: sla.ensureSla,
    markFirstResponse: sla.markFirstResponse,
    markTransition: sla.markTransition,
    requestApproval: approval.requestApproval,
    deliverWebhook: webhook.deliver,
    synchronizePublishedPage: documents.synchronizePublishedPage,
    finishPagePublication: documents.finishPagePublication,
  });
  await import("./capabilities/tools.ts");
}
