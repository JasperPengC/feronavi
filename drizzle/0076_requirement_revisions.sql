CREATE TABLE requirement_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
  revision_no integer NOT NULL,
  work_item_version integer NOT NULL,
  title text NOT NULL,
  description text,
  author_id uuid REFERENCES member(id) ON DELETE SET NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT requirement_revision_positive CHECK (revision_no > 0 AND work_item_version > 0),
  CONSTRAINT requirement_revision_source CHECK (source IN ('INITIAL', 'EDIT', 'BASELINE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX requirement_revision_number_key ON requirement_revision(work_item_id, revision_no);
--> statement-breakpoint
CREATE UNIQUE INDEX requirement_revision_version_key ON requirement_revision(work_item_id, work_item_version);
--> statement-breakpoint
-- 升级时捕获当前正文；作者未知、时间为捕获时间，不伪造原始创建历史。
INSERT INTO requirement_revision(work_item_id, revision_no, work_item_version, title, description, author_id, source)
SELECT id, 1, version, title, description, NULL, 'BASELINE' FROM work_item WHERE type = 'REQUIREMENT';
--> statement-breakpoint
CREATE FUNCTION protect_requirement_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- 成员物理删除可清除外键；其余快照内容及元数据只追加。
  IF (to_jsonb(NEW) - 'author_id') IS DISTINCT FROM (to_jsonb(OLD) - 'author_id')
     OR (NEW.author_id IS DISTINCT FROM OLD.author_id AND NEW.author_id IS NOT NULL) THEN
    RAISE EXCEPTION 'requirement revision is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER requirement_revision_immutable BEFORE UPDATE ON requirement_revision
FOR EACH ROW EXECUTE FUNCTION protect_requirement_revision();
