CREATE TABLE test_plan (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
 number integer NOT NULL, title text NOT NULL, build text NOT NULL, environment text NOT NULL,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','RUNNING','COMPLETED','CANCELLED')), version integer NOT NULL DEFAULT 1,
 created_by uuid REFERENCES member(id) ON DELETE SET NULL, started_at timestamptz, finished_at timestamptz, cancel_reason text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT test_plan_project_number UNIQUE(project_id,number),CONSTRAINT test_plan_positive CHECK(number>0 AND version>0)
);
--> statement-breakpoint
CREATE TABLE test_plan_case (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_id uuid NOT NULL REFERENCES test_plan(id) ON DELETE RESTRICT,
 case_id uuid NOT NULL REFERENCES test_case(id) ON DELETE RESTRICT, revision_id uuid NOT NULL REFERENCES test_case_revision(id) ON DELETE RESTRICT,
 position integer NOT NULL CHECK(position>=0),CONSTRAINT test_plan_case_unique UNIQUE(plan_id,case_id),CONSTRAINT test_plan_case_position UNIQUE(plan_id,position)
);
--> statement-breakpoint
CREATE TABLE test_run (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
 plan_case_id uuid NOT NULL REFERENCES test_plan_case(id) ON DELETE RESTRICT, attempt integer NOT NULL CHECK(attempt>0),
 retest_of uuid REFERENCES test_run(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 status text NOT NULL DEFAULT 'IN_PROGRESS' CHECK(status IN ('IN_PROGRESS','PASSED','FAILED','BLOCKED','SKIPPED','CANCELLED')),
 results jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(results)='array'), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 source text NOT NULL CHECK(source IN ('MANUAL','AGENT','AUTOMATION')), source_reference text,
 executor_id uuid REFERENCES member(id) ON DELETE SET NULL,
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, cancel_reason text,
 CONSTRAINT test_run_attempt UNIQUE(plan_case_id,attempt)
);
--> statement-breakpoint
CREATE UNIQUE INDEX test_run_one_active ON test_run(plan_case_id) WHERE status='IN_PROGRESS';
--> statement-breakpoint
CREATE TABLE test_run_defect (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES test_run(id) ON DELETE RESTRICT,
 defect_id uuid NOT NULL REFERENCES work_item(id) ON DELETE RESTRICT, created_by uuid REFERENCES member(id) ON DELETE SET NULL,
 generated boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),CONSTRAINT test_run_defect_unique UNIQUE(run_id,defect_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX test_run_generated_defect ON test_run_defect(run_id) WHERE generated=true;
--> statement-breakpoint
CREATE FUNCTION preserve_finished_test_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status<>'IN_PROGRESS' AND (ROW(NEW.project_id,NEW.plan_case_id,NEW.attempt,NEW.retest_of,NEW.status,NEW.results,NEW.version,NEW.source,NEW.source_reference,NEW.started_at,NEW.finished_at,NEW.cancel_reason)
 IS DISTINCT FROM ROW(OLD.project_id,OLD.plan_case_id,OLD.attempt,OLD.retest_of,OLD.status,OLD.results,OLD.version,OLD.source,OLD.source_reference,OLD.started_at,OLD.finished_at,OLD.cancel_reason)
 OR (NEW.executor_id IS DISTINCT FROM OLD.executor_id AND NEW.executor_id IS NOT NULL))
 THEN RAISE EXCEPTION 'finished test run is immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER test_run_immutable BEFORE UPDATE ON test_run FOR EACH ROW EXECUTE FUNCTION preserve_finished_test_run();
--> statement-breakpoint
CREATE FUNCTION preserve_started_test_plan_case() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM test_plan WHERE id=OLD.plan_id AND status<>'DRAFT') THEN RAISE EXCEPTION 'started test plan scope is immutable'; END IF;
 IF TG_OP<>'DELETE' AND EXISTS(SELECT 1 FROM test_plan WHERE id=NEW.plan_id AND status<>'DRAFT') THEN RAISE EXCEPTION 'started test plan scope is immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER test_plan_case_immutable BEFORE INSERT OR UPDATE OR DELETE ON test_plan_case FOR EACH ROW EXECUTE FUNCTION preserve_started_test_plan_case();
--> statement-breakpoint
CREATE FUNCTION preserve_started_test_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status IN ('COMPLETED','CANCELLED') AND ROW(NEW.status,NEW.version,NEW.finished_at,NEW.cancel_reason)
 IS DISTINCT FROM ROW(OLD.status,OLD.version,OLD.finished_at,OLD.cancel_reason) THEN RAISE EXCEPTION 'finished test plan is immutable'; END IF;
 IF OLD.status<>'DRAFT' AND ROW(NEW.project_id,NEW.number,NEW.title,NEW.build,NEW.environment,NEW.started_at,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.project_id,OLD.number,OLD.title,OLD.build,OLD.environment,OLD.started_at,OLD.created_at)
 THEN RAISE EXCEPTION 'started test plan is immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER test_plan_immutable BEFORE UPDATE ON test_plan FOR EACH ROW EXECUTE FUNCTION preserve_started_test_plan();
