/** REST、MCP 与协作能力发现共用的领域命令目录。 */
const kinds = { Milestone: "milestone", Iteration: "iteration", Release: "release", Module: "module" } as const;
type Operation = "create" | "update" | "complete" | "archive" | "unarchive";
export const PLAN_COMMANDS: Record<string, { kind: typeof kinds[keyof typeof kinds]; operation: Operation }> = Object.fromEntries(
  (Object.keys(kinds) as (keyof typeof kinds)[]).flatMap(suffix => {
    const operations: Operation[] = ["create", "update", "archive", "unarchive"];
    if (suffix === "Iteration" || suffix === "Release") operations.push("complete");
    return operations.map(operation => [`plan.${operation}${suffix}`, { kind: kinds[suffix], operation }]);
  }),
);

export const COLLAB_COMMANDS = {
  WORK_ITEM: ["workitem.update", "workitem.transition", "workitem.assign", "workitem.comment"],
  COMMENT: ["comment.update", "comment.delete"],
  PLAN: Object.keys(PLAN_COMMANDS),
  APPROVAL: ["approval.approve", "approval.reject"],
  AUTOMATION: ["automation.createRule", "automation.updateRule", "automation.disableRule", "automation.deleteRule", "automation.dryRun"],
} as const;

export const WRITE_ACTIONS = new Set<string>(Object.values(COLLAB_COMMANDS).flat());
