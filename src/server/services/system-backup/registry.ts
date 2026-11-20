import { and, eq, isNull, like } from "drizzle-orm";
import type { BackupMode } from "../../../shared/schemas/system-backup.ts";
import { contentDatasets } from "./datasets/content.ts";
import { collaborationDatasets } from "./datasets/collaboration.ts";
import { identityDatasets } from "./datasets/identity.ts";
import { operationDatasets } from "./datasets/operations.ts";
import { projectDatasets } from "./datasets/projects.ts";
import { securityDatasets } from "./datasets/security.ts";
import type { DatasetDefinition, TableDisposition } from "./types.ts";

export type {
  DatasetDefinition,
  DeferredReferenceColumn,
  ImportContext,
  TableDisposition,
} from "./types.ts";

export const datasetRegistry: readonly DatasetDefinition[] = [
  ...identityDatasets,
  ...projectDatasets,
  ...contentDatasets,
  ...collaborationDatasets,
  ...operationDatasets,
  ...securityDatasets,
];

export const tableClassifications = {
  metric_snapshot: "rebuild",
  page_chunk: "rebuild",
  chunk_embedding: "rebuild",
  index_job: "rebuild",
  session: "exclude",
  password_reset_token: "exclude",
  invite: "exclude",
  sso_login_state: "exclude",
  sync_cursor: "exclude",
  idempotency_key: "exclude",
  job: "exclude",
  assistant_artifact: "exclude",
  collab_member: "exclude",
  setup_state: "control",
  system_backup: "control",
  system_restore: "control",
} as const satisfies Readonly<
  Record<string, Exclude<TableDisposition, "migrate">>
>;

export function classifyDatabaseTable(
  name: string,
): TableDisposition | undefined {
  if (datasetRegistry.some((dataset) => dataset.tableName === name))
    return "migrate";
  return tableClassifications[name as keyof typeof tableClassifications];
}

export function orderedDatasets(mode: BackupMode): DatasetDefinition[] {
  const included = datasetRegistry.filter(
    (dataset) => mode === "full" || dataset.minimumMode === "safe",
  );
  const byName = new Map(included.map((dataset) => [dataset.name, dataset]));
  const ordered: DatasetDefinition[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (dataset: DatasetDefinition) => {
    if (visited.has(dataset.name)) return;
    if (visiting.has(dataset.name))
      throw new Error(`Dataset dependency cycle at ${dataset.name}`);
    visiting.add(dataset.name);
    for (const dependency of dataset.dependsOn) {
      const parent = byName.get(dependency);
      if (!parent)
        throw new Error(
          `Missing dataset dependency ${dependency} required by ${dataset.name}`,
        );
      visit(parent);
    }
    visiting.delete(dataset.name);
    visited.add(dataset.name);
    ordered.push(dataset);
  };

  for (const dataset of included) visit(dataset);
  return ordered;
}

export async function assertRecoverableLocalAdmin(
  mode: BackupMode,
): Promise<void> {
  void mode;
  const [{ db }, schema] = await Promise.all([
    import("../../../db/index.ts"),
    import("../../../db/schema.ts"),
  ]);
  const { member, role, roleAssignment } = schema;
  const admins = await db
    .select({ id: member.id })
    .from(member)
    .innerJoin(roleAssignment, eq(roleAssignment.memberId, member.id))
    .innerJoin(role, eq(role.id, roleAssignment.roleId))
    .where(
      and(
        eq(member.status, "ACTIVE"),
        eq(role.key, "ADMIN"),
        eq(roleAssignment.scopeType, "ORG"),
        isNull(roleAssignment.scopeId),
        like(member.passwordHash, "$argon2%"),
      ),
    )
    .limit(1);
  if (admins.length === 0)
    throw new Error(
      "请先创建至少一名启用的本地 ORG ADMIN 恢复管理员，再生成系统备份",
    );
}
