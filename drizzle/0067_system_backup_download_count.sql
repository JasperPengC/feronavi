ALTER TABLE "system_backup"
  ADD COLUMN "download_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "system_backup"
  ADD CONSTRAINT "system_backup_download_count_check" CHECK ("download_count" >= 0);
