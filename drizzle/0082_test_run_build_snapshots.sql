ALTER TABLE test_run ADD COLUMN build text, ADD COLUMN environment text;
--> statement-breakpoint
UPDATE test_run r SET build=p.build,environment=p.environment FROM test_plan_case s JOIN test_plan p ON p.id=s.plan_id WHERE s.id=r.plan_case_id;
--> statement-breakpoint
ALTER TABLE test_run ALTER COLUMN build SET NOT NULL, ALTER COLUMN environment SET NOT NULL;
--> statement-breakpoint
ALTER TABLE test_run ADD CONSTRAINT test_run_build_nonempty CHECK(length(btrim(build)) BETWEEN 1 AND 200), ADD CONSTRAINT test_run_environment_nonempty CHECK(length(btrim(environment)) BETWEEN 1 AND 300);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION preserve_finished_test_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.build,NEW.environment) IS DISTINCT FROM ROW(OLD.build,OLD.environment) THEN RAISE EXCEPTION 'test run build is immutable'; END IF;
 IF OLD.status<>'IN_PROGRESS' AND (ROW(NEW.project_id,NEW.plan_case_id,NEW.attempt,NEW.retest_of,NEW.status,NEW.results,NEW.version,NEW.source,NEW.source_reference,NEW.started_at,NEW.finished_at,NEW.cancel_reason)
 IS DISTINCT FROM ROW(OLD.project_id,OLD.plan_case_id,OLD.attempt,OLD.retest_of,OLD.status,OLD.results,OLD.version,OLD.source,OLD.source_reference,OLD.started_at,OLD.finished_at,OLD.cancel_reason)
 OR (NEW.executor_id IS DISTINCT FROM OLD.executor_id AND NEW.executor_id IS NOT NULL))
 THEN RAISE EXCEPTION 'finished test run is immutable'; END IF;
 RETURN NEW;
END $$;
