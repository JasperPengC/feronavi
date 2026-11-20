import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  assertRecoverableLocalAdmin,
  classifyDatabaseTable,
  datasetRegistry,
  orderedDatasets,
} from "../src/server/services/system-backup/registry.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const { sql } = await import("../src/db/index.ts");
try {
  const columns = await sql<
    { table_name: string; column_name: string; data_type: string }[]
  >`
    select t.table_name, c.column_name, c.data_type
    from information_schema.tables t
    join information_schema.columns c using (table_schema, table_name)
    where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
    order by t.table_name, c.ordinal_position
  `;
  const actual = new Map<string, Map<string, string>>();
  for (const column of columns) {
    if (column.table_name === "__drizzle_migrations") continue;
    const table = actual.get(column.table_name) ?? new Map<string, string>();
    table.set(column.column_name, column.data_type);
    actual.set(column.table_name, table);
  }

  const counts = new Map<string, number>();
  const unclassified: string[] = [];
  for (const tableName of actual.keys()) {
    const disposition = classifyDatabaseTable(tableName);
    if (!disposition) unclassified.push(tableName);
    else counts.set(tableName, (counts.get(tableName) ?? 0) + 1);
  }
  assert.deepEqual(
    unclassified,
    [],
    `Unclassified public tables: ${unclassified.join(", ")}`,
  );
  const missingOrDuplicate = [...actual.keys()].filter(
    (name) => counts.get(name) !== 1,
  );
  assert.deepEqual(
    missingOrDuplicate,
    [],
    `Tables without exactly one classification: ${missingOrDuplicate.join(", ")}`,
  );

  const registryTables = datasetRegistry.map((dataset) => dataset.tableName);
  assert.equal(
    new Set(registryTables).size,
    registryTables.length,
    "Each migration table must have one dataset",
  );
  const migrationTables = [...actual.keys()]
    .filter((name) => classifyDatabaseTable(name) === "migrate")
    .sort();
  assert.deepEqual(
    [...registryTables].sort(),
    migrationTables,
    "Migration classification must match dataset registry",
  );
  for (const dataset of datasetRegistry) {
    const table = actual.get(dataset.tableName);
    assert.ok(table, `Missing database table ${dataset.tableName}`);
    assert.deepEqual(
      [...dataset.columns].sort(),
      [...table.keys()].sort(),
      `${dataset.name} columns differ from database schema`,
    );
    for (const column of dataset.dateColumns)
      assert.equal(
        table.get(column),
        "timestamp with time zone",
        `${dataset.name}.${column} must be a timestamp column`,
      );
    for (const column of dataset.orderBy)
      assert.ok(
        table.has(column),
        `${dataset.name} orderBy column ${column} is missing`,
      );
    for (const column of dataset.selfReferenceColumns)
      assert.ok(
        table.has(column),
        `${dataset.name} self-reference column ${column} is missing`,
      );
    for (const reference of dataset.deferredReferenceColumns) {
      assert.ok(
        table.has(reference.column),
        `${dataset.name}.${reference.column} is missing`,
      );
      assert.ok(
        datasetRegistry.some(
          (target) =>
            target.name === reference.targetDataset &&
            target.columns.includes(reference.targetColumn),
        ),
        `${dataset.name} has unresolved deferred reference ${reference.targetDataset}.${reference.targetColumn}`,
      );
    }
  }
  orderedDatasets("safe");
  orderedDatasets("full");

  await Promise.all(
    (["safe", "full"] as const).map((mode) =>
      assert.rejects(assertRecoverableLocalAdmin(mode), /本地 ORG ADMIN/u),
    ),
  );
  const [{ id: adminRoleId }] = await sql<
    { id: string }[]
  >`select id from role where key = 'ADMIN' limit 1`;
  const memberId = randomUUID();
  await sql`insert into member (id, username, name, status, password_hash) values (${memberId}, ${`reg-${memberId.slice(0, 12)}`}, 'Registry recovery admin', 'ACTIVE', '$argon2id$test-only')`;
  await sql`insert into role_assignment (member_id, role_id, scope_type, scope_id) values (${memberId}, ${adminRoleId}, 'ORG', null)`;
  await assertRecoverableLocalAdmin("safe");
  await assertRecoverableLocalAdmin("full");

  console.log(
    `Registry coverage passed for ${actual.size} public tables and ${datasetRegistry.length} migration datasets.`,
  );
} finally {
  await sql.end();
}
