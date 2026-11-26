import { t } from "../../i18n/index.ts";
import { WorkItemTag } from "../work-item/WorkItemTag.tsx";
export const testingEndpoint = (projectId: string) =>
  `/api/v1/projects/${projectId}/testing`;
export const testingKey = (projectId: string) =>
  ["testing", projectId] as const;
export function TestStatusTag({ status }: { status: string }) {
  return (
    <WorkItemTag
      kind="status"
      value={
        ["READY", "PASSED", "COMPLETED"].includes(status)
          ? "DONE"
          : status === "RUNNING"
            ? "IN_PROGRESS"
            : status
      }
      stateKey={status}
      label={t(`testing.state.${status}`)}
    />
  );
}
