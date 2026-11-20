/** Server-owned execution facts, independent of model prose. */
export function assistantModelToolName(tool: { name: string; kind: string }) {
  return `${tool.kind === "write" ? "propose_" : ""}${tool.name.replaceAll(".", "_")}`;
}
/** Conservative check for the observed false-card claims; action existence remains server-owned. */
export function claimsAssistantConfirmation(content: string): boolean {
  return content.split(/[。！？\n，,；;]/).some(clause => {
    if (/(?:未|没有|尚未|并未|还未|无法|不能|不曾|未能|不应|不可|不要|不必|无需)[^，,。！？\n]{0,8}(?:生成|创建|登记|准备|点击|点选)|\b(?:not|never|no)\b.{0,15}\b(?:created|generated|registered|prepared|click|press|select)/i.test(clause)) return false;
    return /(?:已(?:经)?.{0,24}(?:生成|创建|登记|准备).{0,30}(?:建议|确认卡|操作卡)|(?:建议|确认卡|操作卡).{0,10}已(?:生成|创建|登记|准备)|请.{0,16}(?:点击|点选|点).{0,8}确认|(?:created|generated|registered|prepared).{0,45}(?:proposal|confirmation card)|(?:please|you can)\s+(?:click|press|select)\s+(?:the\s+)?confirm)/i.test(clause);
  });
}
/** Only explicit proposal requests earn a planning retry; explanatory/negative queries do not. */
export function requestsAssistantProposal(question: string): boolean {
  if (/(?:如何|怎么|怎样|是否|有没有|说明|解释|介绍|能否|可以|你能).{0,30}(?:生成|创建|登记|准备)|(?:不要|不必|无需|别)(?:再|先|帮我|为我)?(?:生成|创建|登记|准备)|\b(?:how|whether|explain|describe|can you)\b.{0,30}\b(?:create|generate|register|prepare)|\b(?:do not|don't|never)\s+(?:create|generate|register|prepare)/i.test(question)) return false;
  return /(?:生成|创建|登记|准备)[^。！？\n]{0,24}(?:建议|操作卡|确认卡)|(?:create|generate|register|prepare).{0,24}(?:proposal|confirmation card)/i.test(question);
}
const planKeys = {
  "plan.listMilestones": "milestones",
  "plan.listIterations": "iterations",
  "plan.listReleases": "releases",
} as const;
type PlanKey = (typeof planKeys)[keyof typeof planKeys];
type PlanState = {
  state: "unverified" | "present" | "empty" | "incomplete" | "failed";
  count?: number;
};
type Observation =
  { projectId: string; key: PlanKey; result: PlanState } | undefined;
export function observeAssistantPlan(
  name: string,
  projectId: string,
  value: unknown,
): Observation {
  const key = planKeys[name as keyof typeof planKeys];
  if (!key) return undefined;
  const row =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  const items = row?.[key];
  let result: PlanState = { state: "failed" };
  if (Array.isArray(items)) {
    const incomplete =
      row?.truncated === true ||
      JSON.stringify(value).length > 40000 ||
      (typeof row?.total === "number" && row.total !== items.length) ||
      (typeof row?.page === "number" && row.page !== 1);
    result = {
      state: incomplete ? "incomplete" : items.length ? "present" : "empty",
      count: items.length,
    };
  }
  return { projectId, key, result };
}
export function assistantExecutionState(
  projectIds: string[],
  actions: { id: string; status?: string }[],
  observations: Observation[],
) {
  const actionIds = actions
    .filter((a) => a.status === "pending")
    .map((a) => a.id);
  return {
    type: "assistant_execution_state",
    confirmation: { available: actionIds.length > 0, actionIds },
    plans: projectIds.map((projectId) => {
      const states: Record<PlanKey, PlanState> = {
        milestones: { state: "unverified" },
        iterations: { state: "unverified" },
        releases: { state: "unverified" },
      };
      for (const observation of observations)
        if (observation?.projectId === projectId)
          states[observation.key] = observation.result;
      return {
        projectId,
        ...states,
        canClaimNoSupportedPlans: Object.values(states).every(
          (s) => s.state === "empty",
        ),
      };
    }),
  };
}
