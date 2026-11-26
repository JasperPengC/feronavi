CREATE TABLE release_candidate (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
 release_id uuid NOT NULL REFERENCES release(id) ON DELETE RESTRICT,number integer NOT NULL CHECK(number>0),
 source_id uuid NOT NULL REFERENCES delivery_source(id) ON DELETE RESTRICT,source_version integer NOT NULL CHECK(source_version>0),
 repository text NOT NULL,commit_sha text NOT NULL CHECK(commit_sha ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'),build text NOT NULL,environment text NOT NULL,
 workflow_ids jsonb NOT NULL CHECK(jsonb_typeof(workflow_ids)='array' AND jsonb_array_length(workflow_ids)>0),
 test_plan_ids jsonb NOT NULL CHECK(jsonb_typeof(test_plan_ids)='array' AND jsonb_array_length(test_plan_ids)>0),
 work_items jsonb NOT NULL CHECK(jsonb_typeof(work_items)='array'),
 created_by uuid REFERENCES member(id) ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT release_candidate_number UNIQUE(release_id,number)
);
--> statement-breakpoint
CREATE TABLE release_verification (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
 release_id uuid NOT NULL UNIQUE REFERENCES release(id) ON DELETE RESTRICT,candidate_id uuid NOT NULL UNIQUE REFERENCES release_candidate(id) ON DELETE RESTRICT,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),created_by uuid REFERENCES member(id) ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE release_feedback (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
 release_id uuid NOT NULL REFERENCES release(id) ON DELETE RESTRICT,work_item_id uuid NOT NULL REFERENCES work_item(id) ON DELETE RESTRICT,
 source_url text NOT NULL,conclusion text NOT NULL,outcome text NOT NULL CHECK(outcome IN ('RESOLVED','FOLLOW_UP')),
 created_by uuid REFERENCES member(id) ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX release_feedback_order ON release_feedback(release_id,created_at,id);
--> statement-breakpoint
CREATE TRIGGER release_candidate_immutable BEFORE UPDATE OR DELETE ON release_candidate FOR EACH ROW EXECUTE FUNCTION preserve_delivery_evidence();
--> statement-breakpoint
CREATE TRIGGER release_verification_immutable BEFORE UPDATE OR DELETE ON release_verification FOR EACH ROW EXECUTE FUNCTION preserve_delivery_evidence();
--> statement-breakpoint
CREATE TRIGGER release_feedback_immutable BEFORE UPDATE OR DELETE ON release_feedback FOR EACH ROW EXECUTE FUNCTION preserve_delivery_evidence();
