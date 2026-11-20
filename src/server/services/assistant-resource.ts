/** 助手资源事实：通用目标、当前读取、确认指纹和同事务行锁。 */
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  comment,
  workItem,
  page,
  milestone,
  iteration,
  release,
  module,
  idea,
} from "../../db/schema.ts";
import { DomainError } from "../../shared/errors.ts";
import type {
  RagActionProposal,
  RagResourceKind,
  RagResourceRef,
} from "../../shared/rag.ts";
import type { Actor } from "../permission/actor.ts";
import { getWorkItem } from "./work-item.service.ts";
import { getPage } from "./wiki.service.ts";
import { get as getPlan } from "./planning.service.ts";
import { getIdea } from "./idea.service.ts";
import { lockProjectTree } from "./project-tree.ts";

export function assistantActionTarget(
  name: string,
  args: Record<string, unknown>,
): RagResourceRef | undefined {
  const key = name.startsWith("workitem.")
    ? name === "workitem.link"
      ? "fromWorkItemId"
      : "workItemId"
    : name.startsWith("idea.")
      ? "ideaId"
      : name.startsWith("page.")
        ? "pageId"
        : name.startsWith("comment.")
          ? "commentId"
          : ["milestone", "iteration", "release", "module"]
              .find((kind) =>
                name.endsWith(kind[0]!.toUpperCase() + kind.slice(1)),
              )
              ?.concat("Id");
  if (!key || typeof args[key] !== "string") return undefined;
  return {
    kind:
      key === "fromWorkItemId"
        ? "workItem"
        : (key.slice(0, -2) as RagResourceKind),
    id: args[key],
  };
}

export async function readAssistantResource(
  actor: Actor,
  resource: RagResourceRef,
): Promise<Record<string, unknown> & { projectId: string }> {
  if (resource.kind === "idea") return getIdea(actor, resource.id);
  if (resource.kind === "workItem") return getWorkItem(actor, resource.id);
  if (resource.kind === "page") return getPage(actor, resource.id);
  if (resource.kind !== "comment")
    return getPlan(actor, resource.id, resource.kind);
  const [row] = await db
    .select()
    .from(comment)
    .where(and(eq(comment.id, resource.id), isNull(comment.deletedAt)))
    .limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "评论不存在或不可访问", null);
  const kind = { WORK_ITEM: "workItem", PAGE: "page", MILESTONE: "milestone" }[
    row.targetType
  ] as RagResourceKind | undefined;
  if (!kind) throw new DomainError("NOT_FOUND", "评论目标不可访问", null);
  const target = await readAssistantResource(actor, { kind, id: row.targetId });
  return { ...row, projectId: target.projectId };
}

export function assistantResourceFingerprint(
  value: Record<string, unknown>,
): string {
  // 数据库返回字段顺序不参与版本语义；日期统一为 JSON 的 ISO 表示。
  const canonical = (node: unknown): unknown => {
    if (node instanceof Date) return node.toISOString();
    if (Array.isArray(node)) return node.map(canonical);
    if (node && typeof node === "object")
      return Object.fromEntries(
        Object.entries(node)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return node;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export async function lockAssistantResources(
  projectId: string,
  resources: RagResourceRef[],
) {
  // 与页面/树写入口一致：先项目树锁再资源锁，避免确认与页面更新反向持锁。
  await lockProjectTree(projectId);
  const tables = {
    workItem,
    page,
    milestone,
    iteration,
    release,
    module,
    comment,
    idea,
  };
  for (const resource of [...resources].sort((a, b) =>
    `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
  )) {
    const table = tables[resource.kind];
    await db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.id, resource.id))
      .for("update")
      .limit(1);
  }
}

export async function assertAssistantActionCurrent(
  actor: Actor,
  action: RagActionProposal,
) {
  const target =
    action.target ??
    (action.targetId
      ? { kind: "workItem" as const, id: action.targetId }
      : undefined);
  if (!target) return;
  const current = await readAssistantResource(actor, target);
  const fingerprint = "fingerprint" in target ? target.fingerprint : undefined;
  if (
    current.projectId !== action.projectId ||
    (fingerprint
      ? assistantResourceFingerprint(current) !== fingerprint
      : current.version !== action.expectedVersion)
  )
    throw new DomainError("CONFLICT", "操作建议已过期，请重新生成", null);
}

/** 写入返回值只用于发现身份；显示内容必须由当前授权的领域读取复读。 */
export async function rereadAssistantActionResult(
  actor: Actor,
  name: string,
  raw: unknown,
  projectId: string,
) {
  let value = raw;
  for (
    let depth = 0;
    depth < 3 && value && typeof value === "object" && "result" in value;
    depth++
  )
    value = (value as { result: unknown }).result;
  if (name === "page.update" && value && typeof value === "object" && "page" in value) value = (value as { page: unknown }).page;
  const row =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const kind: RagResourceKind | undefined =
    name === "workitem.comment" || name === "comment.update"
      ? "comment"
      : name.startsWith("workitem.")
        ? "workItem"
        : name.startsWith("page.")
          ? "page"
          : (["milestone", "iteration", "release", "module"].find((kind) =>
              name.endsWith(kind[0]!.toUpperCase() + kind.slice(1)),
            ) as RagResourceKind | undefined);
  if (!kind || typeof row.id !== "string")
    throw new DomainError("INTERNAL", "操作结果缺少可复读的资源", null);
  const resource = { kind, id: row.id };
  const current = await readAssistantResource(actor, resource);
  if (current.projectId !== projectId)
    throw new DomainError("NOT_FOUND", "操作结果不属于授权项目", null);
  return {
    observedAt: new Date().toISOString(),
    resources: [resource],
    value: current,
  };
}
