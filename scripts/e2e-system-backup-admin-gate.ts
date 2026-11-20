import assert from "node:assert/strict";
import { db, sql } from "../src/db/index.ts";
import { member, roleAssignment } from "../src/db/schema.ts";
import { createEncryptionEnvelope } from "../src/server/services/system-backup/crypto.ts";
import { exportSystemBackup } from "../src/server/services/system-backup/exporter.ts";
import { writeTemporaryKeyHandle } from "../src/server/services/system-backup/storage.ts";
import { ensureInitialized } from "./_test-helpers.ts";

await ensureInitialized();
await db.delete(roleAssignment);
await db.delete(member);
const { dataKey, keyEnvelope } = await createEncryptionEnvelope(
  "admin-gate-password",
);
const handle = await writeTemporaryKeyHandle("admin-gate", dataKey);
dataKey.fill(0);
try {
  await exportSystemBackup({
    backupId: "f6c1c63a-09d7-4f8a-b488-c450c4c7688e",
    mode: "safe",
    requestedBy: "missing-admin",
    dataKeyHandle: handle.handle,
    keyEnvelope,
  });
  throw new Error("expected local admin guard");
} catch (error) {
  assert.match(String((error as Error).message), /本地 ORG ADMIN/u);
  console.log("admin gate API/snapshot guard passed");
} finally {
  await sql.end({ timeout: 2 });
}
