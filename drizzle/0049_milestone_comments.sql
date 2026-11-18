-- 里程碑也支持评论：扩展 comment/mention 的目标类型约束。
ALTER TABLE "comment" DROP CONSTRAINT IF EXISTS "comment_target_type_allowed";--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_target_type_allowed"
  CHECK ("target_type" IN ('WORK_ITEM','IDEA','PAGE','MILESTONE'));--> statement-breakpoint
ALTER TABLE "mention" DROP CONSTRAINT IF EXISTS "mention_source_type_allowed";--> statement-breakpoint
ALTER TABLE "mention" ADD CONSTRAINT "mention_source_type_allowed"
  CHECK ("source_type" IN ('WORK_ITEM','PAGE','IDEA','COMMENT','MILESTONE'));
