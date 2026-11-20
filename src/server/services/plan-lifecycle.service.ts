/** 兼容旧应用层入口；所有完成/结转写入统一由生命周期核心执行。 */
import { completeIterationSchema, type PlanCompletionResult } from "../../shared/schemas/planning.ts";
import { DomainError } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { complete } from "./planning-lifecycle.service.ts";

export async function completeIteration(actor: Actor, id: string, raw: unknown = {}): Promise<PlanCompletionResult> {
  const parsed = completeIterationSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError("VALIDATION", "结束迭代参数不合法", parsed.error.issues);
  return (await complete(actor, id, "iteration", parsed.data)).completionResult;
}

export async function completeRelease(actor: Actor, id: string): Promise<PlanCompletionResult> {
  return (await complete(actor, id, "release")).completionResult;
}
