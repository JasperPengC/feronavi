import { t } from "../../i18n/index.ts";
import { WorkItemTag } from "../work-item/WorkItemTag.tsx";
import type { DeliveryEvidenceView } from "../../../shared/schemas/delivery.ts";
export const deliveryEndpoint = (projectId: string) =>
  `/api/v1/projects/${projectId}/delivery`;
export const deliveryKey = (projectId: string) =>
  ["delivery", projectId] as const;
export function DeliveryStatus({ status }: { status: string }) {
  return (
    <WorkItemTag
      kind="status"
      value={
        status === "SUCCEEDED"
          ? "DONE"
          : status === "PENDING"
            ? "IN_PROGRESS"
            : status
      }
      stateKey={status}
      label={t(`delivery.status.${status}`)}
    />
  );
}
export function DeliveryVerification({
  row,
}: {
  row: Pick<DeliveryEvidenceView, "verification" | "sourceCurrent">;
}) {
  const trusted = row.verification === "PROVIDER_API" && row.sourceCurrent;
  return (
    <WorkItemTag
      kind="status"
      value={trusted ? "DONE" : "WAITING"}
      stateKey={trusted ? "VERIFIED" : "WAITING"}
      label={t(
        trusted
          ? "delivery.verified"
          : row.verification === "SELF_REPORTED"
            ? "delivery.selfReported"
            : "delivery.expired",
      )}
    />
  );
}
