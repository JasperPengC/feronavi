-- 附件记录落存储后端：切换本地/S3 后，旧附件仍从原位置读取
ALTER TABLE "attachment" ADD COLUMN IF NOT EXISTS "storage_backend" text NOT NULL DEFAULT 'local';
ALTER TABLE "attachment" DROP CONSTRAINT IF EXISTS "attachment_storage_backend_allowed";
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_storage_backend_allowed"
  CHECK ("storage_backend" IN ('local', 's3'));
