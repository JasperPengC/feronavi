-- 附件挂里程碑：扩展附件目标类型约束。
ALTER TABLE "attachment" DROP CONSTRAINT IF EXISTS "attachment_target_type_allowed";--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_target_type_allowed"
  CHECK ("target_type" IN ('WORK_ITEM','PAGE','IDEA','COMMENT','MILESTONE'));
