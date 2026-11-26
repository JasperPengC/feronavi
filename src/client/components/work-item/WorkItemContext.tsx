import { useQueries, useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { WorkItemTag } from "./WorkItemTag.tsx";

export function WorkItemContext({ item }: { item: { projectId: string; productId?: string | null; type?: string; statusName?: string | null; statusCategory?: string | null; statusKey?: string | null; assigneeId: string | null; milestoneId?: string | null; iterationId?: string | null; releaseId?: string | null } }) {
  const product = useQuery({ queryKey: ["product-detail", item.projectId, item.productId], enabled: !!item.productId, retry: false,
    queryFn: () => apiGet<{ name: string; archivedAt: string | null }>(`/api/v1/projects/${item.projectId}/products/${item.productId}`) });
  const members = useQuery({
    queryKey: ["project-members", item.projectId],
    enabled: !!item.assigneeId,
    retry: false,
    staleTime: 60_000,
    queryFn: () => apiGet<{ members: { id: string; name: string; username: string }[] }>(`/api/v1/projects/${item.projectId}/members`).then(result => result.members ?? []),
  });
  const refs = [
    { kind: "milestone", path: "milestones", id: item.milestoneId, label: t("ms.kindMilestone") },
    { kind: "iteration", path: "iterations", id: item.iterationId, label: t("ms.kindIteration") },
    { kind: "release", path: "releases", id: item.releaseId, label: t("ms.kindRelease") },
  ];
  const plans = useQueries({ queries: refs.map(ref => ({
    queryKey: ["plan-entities", ref.kind, item.projectId], enabled: !!ref.id, retry: false,
    queryFn: () => apiGet<{ id: string; name: string }[]>(`/api/v1/projects/${item.projectId}/${ref.path}`),
  })) });
  const assignee = members.data?.find(member => member.id === item.assigneeId);
  return <>
    <div><dt>{t("wiDetail.status")}</dt><dd><WorkItemTag kind="status" value={item.statusCategory} stateKey={item.statusKey} label={item.statusName} /></dd></div>
    <div><dt>{t("common.assignee")}</dt><dd>{item.assigneeId ? assignee?.name || assignee?.username || "—" : t("wie.unassigned")}</dd></div>
    {item.type === "REQUIREMENT" && <div><dt>{t("product.attribution")}</dt><dd>{item.productId ? product.isError ? t("common.loadFailedShort") : product.data?.name ?? t("common.loading") : t("product.none")}{product.data?.archivedAt && <span className="tag">{t("product.archived")}</span>}</dd></div>}
    {refs.map((ref, index) => ref.id ? <div key={ref.kind}><dt>{ref.label}</dt><dd>{plans[index]?.data?.find(plan => plan.id === ref.id)?.name || "—"}</dd></div> : null)}
  </>;
}
