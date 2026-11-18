-- 同一服务/同一 scope 下允许配置多个仓库：
-- 原唯一索引只覆盖 kind + project + base_url，导致同一 GitLab 实例的第二个 repo 无法添加。
DROP INDEX IF EXISTS "integration_kind_project_url_key";
CREATE INDEX IF NOT EXISTS "integration_kind_project_url_idx" ON "integration" ("kind", "project_id", "base_url");
