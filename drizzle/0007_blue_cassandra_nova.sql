DROP INDEX "module_parent_name_key";--> statement-breakpoint
ALTER TABLE "attachment" ALTER COLUMN "size_bytes" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "module" ADD COLUMN "lead_member_id" uuid;--> statement-breakpoint
ALTER TABLE "module" ADD CONSTRAINT "module_lead_member_id_member_id_fk" FOREIGN KEY ("lead_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "module_parent_name_key" ON "module" USING btree ("project_id","parent_id","name");--> statement-breakpoint
-- ═════════════════════════════════════════════════════════════
-- 手写补丁（非 drizzle-kit 生成）
--
-- 规范一致性同步：把「数据模型文档 7.1–7.4 / 2.5 节明确写了 CHECK、
-- 而此前迁移漏建」的约束补齐。这些枚举列此前只靠应用层校验，
-- 任何绕过应用的写入（脚本/人工 psql）都能塞进非法值。
-- ⚠️ 重跑 generate 会覆盖本段 —— 生成后必须重新补上。
-- ═════════════════════════════════════════════════════════════

ALTER TABLE "comment" ADD CONSTRAINT "comment_target_type_allowed"
  CHECK ("target_type" IN ('WORK_ITEM','IDEA','PAGE'));
ALTER TABLE "mention" ADD CONSTRAINT "mention_source_type_allowed"
  CHECK ("source_type" IN ('WORK_ITEM','PAGE','IDEA','COMMENT'));
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_target_type_allowed"
  CHECK ("target_type" IN ('WORK_ITEM','PAGE','IDEA','COMMENT'));
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_target_type_allowed"
  CHECK ("target_type" IN ('WORK_ITEM','IDEA','PAGE'));
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_notify_channel_allowed"
  CHECK ("notify_channel" IN ('IN_APP','EMAIL'));
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_view_type_allowed"
  CHECK ("view_type" IN ('LIST','BOARD','TABLE','CALENDAR','TIMELINE'));
ALTER TABLE "notification" ADD CONSTRAINT "notification_category_allowed"
  CHECK ("category" IN ('MENTION','ASSIGN','TRANSITION','FIELD_CHANGE','ANNOUNCEMENT'));
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_digest_allowed"
  CHECK ("digest_frequency" IN ('OFF','DAILY','WEEKLY'));
