-- 看板列 WIP 上限（NULL = 不限制）
ALTER TABLE "workflow_state" ADD COLUMN IF NOT EXISTS "wip_limit" integer;
