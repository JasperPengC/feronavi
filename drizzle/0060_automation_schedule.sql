ALTER TABLE "automation_rule" ADD COLUMN "schedule_cron" text;
--> statement-breakpoint
ALTER TABLE "automation_rule" ADD COLUMN "schedule_timezone" text DEFAULT 'Asia/Shanghai';
--> statement-breakpoint
ALTER TABLE "automation_rule" ADD COLUMN "last_scheduled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "automation_rule" DROP CONSTRAINT "automation_rule_trigger_allowed";
--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_trigger_allowed" CHECK ("automation_rule"."trigger" IN ('WORK_ITEM_CREATED','WORK_ITEM_UPDATED','STATUS_CHANGED','COMMENT_ADDED','SLA_BREACHED','SCHEDULE'));
