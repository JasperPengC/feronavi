ALTER TABLE "setup_state" ADD COLUMN "restored_package_id" uuid;
--> statement-breakpoint
ALTER TABLE "system_restore" ADD COLUMN "manifest_hash" text;
--> statement-breakpoint
ALTER TABLE "system_restore" ADD CONSTRAINT "system_restore_manifest_hash_check" CHECK ("manifest_hash" IS NULL OR "manifest_hash" ~ '^[a-f0-9]{64}$');
