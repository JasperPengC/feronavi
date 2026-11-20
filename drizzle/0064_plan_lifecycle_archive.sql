ALTER TABLE "iteration" ADD COLUMN "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "release" ADD COLUMN "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "iteration" ADD COLUMN "completion_result" jsonb;
--> statement-breakpoint
ALTER TABLE "release" ADD COLUMN "completion_result" jsonb;
