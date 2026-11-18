-- AI 供应商备注：多供应商时用于区分用途（生产/测试/内部集群等）
ALTER TABLE "ai_provider_config" ADD COLUMN IF NOT EXISTS "note" text;
