import "./_env.ts";
/** 真实PG：空选填设置可清除，敏感值null保持，整批失败不能留下半份配置。 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/index.ts";
import { setting } from "../src/db/schema.ts";
import { getSettingRaw, putSettings } from "../src/server/services/setting.service.ts";
import { closeCache } from "../src/server/auth/cache.ts";
try {
  await putSettings({ "storage.s3.endpoint": "https://example.test", "smtp.password": "fixture-only-secret" });
  await putSettings({ "storage.kind": "local", "storage.s3.endpoint": null, "storage.s3.bucket": null, "storage.s3.prefix": null, "smtp.password": null });
  assert.equal(await getSettingRaw("storage.kind"), "local");
  assert.equal(await getSettingRaw("storage.s3.endpoint"), null);
  assert.equal(await getSettingRaw("storage.s3.bucket"), null);
  assert.equal(await getSettingRaw("smtp.password"), "fixture-only-secret");
  console.log("PASS 可选字段null清除，无SQL NOT NULL错误；敏感键null保持原密文");
  await sql.unsafe(`create function settings_patch_fault() returns trigger language plpgsql as $$ begin
    if NEW.key='storage.s3.region' then raise exception 'injected settings failure'; end if; return NEW; end $$;
    create trigger settings_patch_fault before insert or update on setting for each row execute function settings_patch_fault();`);
  try {
    await assert.rejects(putSettings({ "storage.kind": "s3", "storage.s3.region": "eu-west-1" }));
    assert.equal(await getSettingRaw("storage.kind"), "local");
    assert.equal((await db.select().from(setting).where(eq(setting.key, "storage.s3.region"))).length, 0);
    console.log("PASS 设置第二项故障时，第一项整体回滚");
  } finally { await sql.unsafe("drop trigger settings_patch_fault on setting; drop function settings_patch_fault()"); }
} finally { await closeCache(); await sql.end(); }
