CREATE TABLE test_suite (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
 name text NOT NULL, description text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1,
 created_by uuid REFERENCES member(id) ON DELETE SET NULL, archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT test_suite_version CHECK(version>0)
);
--> statement-breakpoint
CREATE TABLE test_case (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
 number integer NOT NULL, title text NOT NULL, status text NOT NULL DEFAULT 'DRAFT', priority text NOT NULL DEFAULT 'MEDIUM',
 suite_id uuid REFERENCES test_suite(id) ON DELETE RESTRICT, owner_id uuid REFERENCES member(id) ON DELETE SET NULL,
 current_revision_id uuid, version integer NOT NULL DEFAULT 1, created_by uuid REFERENCES member(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT test_case_project_number UNIQUE(project_id,number),
 CONSTRAINT test_case_status CHECK(status IN ('DRAFT','READY','ARCHIVED')),
 CONSTRAINT test_case_priority CHECK(priority IN ('LOWEST','LOW','MEDIUM','HIGH','URGENT')),
 CONSTRAINT test_case_positive CHECK(number>0 AND version>0)
);
--> statement-breakpoint
CREATE TABLE test_case_revision (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES test_case(id) ON DELETE RESTRICT,
 revision_no integer NOT NULL CHECK(revision_no>0), title text NOT NULL, preconditions text NOT NULL DEFAULT '', steps jsonb NOT NULL,
 created_by uuid REFERENCES member(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT test_case_revision_number UNIQUE(case_id,revision_no),
 CONSTRAINT test_case_steps CHECK(jsonb_typeof(steps)='array')
);
--> statement-breakpoint
ALTER TABLE test_case ADD CONSTRAINT test_case_current_revision_fk FOREIGN KEY(current_revision_id) REFERENCES test_case_revision(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE TABLE test_case_requirement (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_revision_id uuid NOT NULL REFERENCES test_case_revision(id) ON DELETE RESTRICT,
 work_item_id uuid NOT NULL REFERENCES work_item(id) ON DELETE RESTRICT, requirement_revision_id uuid NOT NULL REFERENCES requirement_revision(id) ON DELETE RESTRICT,
 CONSTRAINT test_case_requirement_unique UNIQUE(case_revision_id,work_item_id)
);
--> statement-breakpoint
CREATE INDEX test_case_requirement_work_item_idx ON test_case_requirement(work_item_id);
--> statement-breakpoint
CREATE FUNCTION preserve_test_case_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.case_id,NEW.revision_no,NEW.title,NEW.preconditions,NEW.steps,NEW.created_at) IS DISTINCT FROM ROW(OLD.case_id,OLD.revision_no,OLD.title,OLD.preconditions,OLD.steps,OLD.created_at)
 THEN RAISE EXCEPTION 'test case revision is immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER test_case_revision_immutable BEFORE UPDATE ON test_case_revision FOR EACH ROW EXECUTE FUNCTION preserve_test_case_revision();
--> statement-breakpoint
CREATE FUNCTION preserve_test_case_requirement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'test case requirement is immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER test_case_requirement_immutable BEFORE UPDATE ON test_case_requirement FOR EACH ROW EXECUTE FUNCTION preserve_test_case_requirement();
--> statement-breakpoint
ALTER TABLE requirement_change_impact DROP CONSTRAINT requirement_change_impact_kind;
--> statement-breakpoint
ALTER TABLE requirement_change_impact ADD CONSTRAINT requirement_change_impact_kind CHECK(kind IN ('WORK_ITEM','MILESTONE','ITERATION','RELEASE','TEST_CASE'));
--> statement-breakpoint
INSERT INTO permission(key,"group",description) VALUES
 ('test_case:manage','test','维护正式测试用例、版本和套件'),
 ('test_plan:manage','test','管理测试计划与构建环境'),
 ('test_run:execute','test','执行测试、提交结果和复测') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permission(role_id,permission_key)
 SELECT r.id,p.key FROM role r CROSS JOIN permission p
 WHERE r.is_builtin=true AND (r.key IN ('ADMIN','PM') AND p.key IN ('test_case:manage','test_plan:manage','test_run:execute')
 OR r.key='MEMBER' AND p.key IN ('test_case:manage','test_run:execute')) ON CONFLICT DO NOTHING;
