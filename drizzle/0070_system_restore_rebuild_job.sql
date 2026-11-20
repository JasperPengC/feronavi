ALTER TABLE "system_restore" ADD COLUMN "rebuild_job_id" uuid;
--> statement-breakpoint
ALTER TABLE "system_restore" ADD COLUMN "rebuild_completed_at" timestamp with time zone;
