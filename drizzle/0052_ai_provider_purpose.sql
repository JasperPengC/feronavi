-- AI 供应商用途：LLM（对话） / EMBEDDING（向量） / BOTH（旧配置兼容）
ALTER TABLE "ai_provider_config" ADD COLUMN IF NOT EXISTS "purpose" text NOT NULL DEFAULT 'BOTH';
ALTER TABLE "ai_provider_config" DROP CONSTRAINT IF EXISTS "ai_provider_purpose_allowed";
ALTER TABLE "ai_provider_config" ADD CONSTRAINT "ai_provider_purpose_allowed"
  CHECK ("purpose" IN ('BOTH', 'LLM', 'EMBEDDING'));
