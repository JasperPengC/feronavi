ALTER TABLE "system_restore"
  ADD COLUMN "owner_session_hash" text;
--> statement-breakpoint
ALTER TABLE "system_restore"
  ADD CONSTRAINT "system_restore_owner_hash_check"
  CHECK ("owner_session_hash" IS NULL OR "owner_session_hash" ~ '^[a-f0-9]{64}$');
