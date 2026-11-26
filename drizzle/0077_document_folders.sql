ALTER TABLE page ADD COLUMN kind text NOT NULL DEFAULT 'DOCUMENT';
--> statement-breakpoint
ALTER TABLE page ADD COLUMN structure_version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE page ADD COLUMN created_by uuid REFERENCES member(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE page ADD COLUMN archived_at timestamptz;
--> statement-breakpoint
ALTER TABLE page ADD CONSTRAINT page_kind_allowed CHECK (kind IN ('DOCUMENT','FOLDER'));
--> statement-breakpoint
ALTER TABLE page ADD CONSTRAINT page_structure_version_positive CHECK (structure_version > 0);
--> statement-breakpoint
ALTER TABLE page ADD CONSTRAINT page_folder_no_revision CHECK (kind <> 'FOLDER' OR current_revision_id IS NULL);
--> statement-breakpoint
UPDATE page p SET created_by = r.author_id FROM page_revision r WHERE r.page_id = p.id AND r.revision_no = 1;
--> statement-breakpoint
-- 归档状态按树派生，不覆盖子节点自身的归档记录；UNION 避免历史坏数据形成递归环。
CREATE VIEW archived_page AS
WITH RECURSIVE archived AS (
  SELECT id, project_id FROM page WHERE archived_at IS NOT NULL
  UNION
  SELECT p.id, p.project_id FROM page p JOIN archived a ON p.parent_id = a.id AND p.project_id = a.project_id
)
SELECT id FROM archived;
