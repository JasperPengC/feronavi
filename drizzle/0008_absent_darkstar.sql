CREATE TABLE "activity_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"actor_id" uuid,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_snapshot" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"changes" jsonb,
	"ip" text,
	"user_agent" text,
	"severity" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_entry" ADD CONSTRAINT "activity_entry_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_entry" ADD CONSTRAINT "activity_entry_actor_id_member_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_project_idx" ON "activity_entry" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_target_idx" ON "activity_entry" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_entry" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_entry" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_severity_idx" ON "audit_entry" USING btree ("severity","created_at");--> statement-breakpoint
-- 手写补丁（数据模型 8.1 明确要求、drizzle 表达不了的）
ALTER TABLE "audit_entry" ADD CONSTRAINT "audit_severity_allowed"
  CHECK ("severity" IN ('SECURITY','BUSINESS'));
ALTER TABLE "audit_entry" ADD CONSTRAINT "audit_actor_no_cascade"
  FOREIGN KEY ("actor_id") REFERENCES "member"("id") ON DELETE RESTRICT;
-- activity_entry.target_id 的自引用语义：多态无外键（与 comment 同理），无需补
--> statement-breakpoint
-- 手写补丁（数据模型 8.1 明确要求、drizzle 表达不了的）
-- ⚠️ 第 32 轮修正：这一条**与上面重复**（同一文件里加了两遍），全新库重放时会报
-- constraint already exists 并**中止整轮迁移**（实测：148/149 条后失败）。
-- 改为幂等：已存在就跳过。**不动上面那一条**，避免改变已应用迁移的语义。
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_severity_allowed') THEN
    ALTER TABLE "audit_entry" ADD CONSTRAINT "audit_severity_allowed" CHECK ("severity" IN ('SECURITY','BUSINESS'));
  END IF;
END $$;
-- 第 32 轮：这一条**与上面重复**，全新库重放时会 already exists 并中止整轮迁移（实测）。
-- 改为幂等（已存在就跳过）；**不动上面那一条**，避免改变已应用迁移的语义。
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_actor_no_cascade') THEN
    ALTER TABLE "audit_entry" ADD CONSTRAINT "audit_actor_no_cascade"
      FOREIGN KEY ("actor_id") REFERENCES "member"("id") ON DELETE RESTRICT;
  END IF;
END $$;
