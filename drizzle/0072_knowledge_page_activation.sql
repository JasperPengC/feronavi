ALTER TABLE index_job ADD COLUMN activated_at timestamp with time zone;
--> statement-breakpoint
-- 历史成功任务按已生效全局上界补记；新任务只有明确激活才参与检索。
UPDATE index_job SET activated_at = coalesce(finished_at, created_at)
WHERE status = 'SUCCEEDED'
  AND generation <= coalesce((SELECT (value #>> '{}')::integer FROM setting WHERE key = 'knowledge.active_generation'), 1);
--> statement-breakpoint
CREATE INDEX index_job_page_active_generation_idx ON index_job (page_id, generation DESC)
WHERE activated_at IS NOT NULL AND status = 'SUCCEEDED';
