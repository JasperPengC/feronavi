import { z } from "zod";
import { db } from "../../db/index.ts";
import { DomainError, forbidden } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import { can } from "../permission/engine.ts";
import * as projects from "../repos/project.repo.ts";
import { lockProjectTree } from "./project-tree.ts";

export type TestPermission =
  "test_case:manage" | "test_plan:manage" | "test_run:execute";
export function testingPermission(
  actor: Actor,
  projectId: string,
  permission: TestPermission,
) {
  return can(
    actor,
    permission,
    { projectId },
    {
      memberId: actor.memberId,
      memberProjectIds: new Set(),
      memberTeamIds: new Set(),
    },
  );
}
export async function readTestProject(actor: Actor, projectId: string) {
  if (
    !(await projects.isVisibleTo(
      actor.memberId,
      projectId,
      actor.grants.some((g) => g.scopeType === "ORG"),
    ))
  )
    throw forbidden();
  const project = await projects.findById(projectId);
  if (!project) throw forbidden();
  return project;
}
export async function canWriteTesting(
  actor: Actor,
  projectId: string,
  permission: TestPermission,
) {
  const project = await readTestProject(actor, projectId);
  return (
    !project.archivedAt &&
    !project.lifecycleLock &&
    testingPermission(actor, projectId, permission)
  );
}
export async function assertWriteTesting(
  actor: Actor,
  projectId: string,
  permission: TestPermission,
) {
  const project = await readTestProject(actor, projectId);
  if (!testingPermission(actor, projectId, permission)) throw forbidden();
  if (project.archivedAt || project.lifecycleLock)
    throw new DomainError("BLOCKED_BY_PREREQUISITE", "项目已归档或锁定", null);
  return project;
}
export async function withTestWrite<T>(
  actor: Actor,
  projectId: string,
  permission: TestPermission,
  fn: () => Promise<T>,
) {
  await readTestProject(actor, projectId);
  return db.transaction(async () => {
    await lockProjectTree(projectId);
    await assertWriteTesting(actor, projectId, permission);
    return fn();
  });
}
export function parseTesting<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new DomainError("VALIDATION", "测试参数不合法", parsed.error.issues);
  return parsed.data;
}
export function testVersion(actual: number, expected: number) {
  if (actual !== expected)
    throw new DomainError(
      "VERSION_CONFLICT",
      "测试记录已更新，请重新读取",
      null,
    );
}
