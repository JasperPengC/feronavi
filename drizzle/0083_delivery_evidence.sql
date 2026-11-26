CREATE TABLE delivery_source (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
 integration_id uuid REFERENCES integration(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED, repository text NOT NULL, api_base_url text NOT NULL,
 integration_updated_at timestamptz NOT NULL, webhook_secret_encrypted text, enabled boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_by uuid REFERENCES member(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT delivery_source_integration UNIQUE(integration_id)
);
--> statement-breakpoint
CREATE TABLE delivery_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
 source_id uuid REFERENCES delivery_source(id) ON DELETE RESTRICT, source_version integer,
 kind text NOT NULL CHECK(kind IN ('COMMIT','PULL_REQUEST','CI','BUILD','DEPLOYMENT')),
 title text NOT NULL, repository text NOT NULL, commit_sha text NOT NULL, build text NOT NULL, environment text,
 status text NOT NULL CHECK(status IN ('PENDING','SUCCEEDED','FAILED','CANCELLED')),
 verification text NOT NULL CHECK(verification IN ('SELF_REPORTED','PROVIDER_API')),
 external_id text NOT NULL, attempt integer NOT NULL DEFAULT 1 CHECK(attempt>0), provider_updated_at timestamptz,
 url text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'),
 created_by uuid REFERENCES member(id) ON DELETE SET NULL, received_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT delivery_evidence_provenance CHECK((verification='SELF_REPORTED' AND source_id IS NULL AND source_version IS NULL AND provider_updated_at IS NULL) OR (verification='PROVIDER_API' AND source_id IS NOT NULL AND source_version>0 AND provider_updated_at IS NOT NULL)),
 CONSTRAINT delivery_evidence_sha CHECK(commit_sha ~ '^([a-f0-9]{40}|[a-f0-9]{64})$')
);
--> statement-breakpoint
CREATE INDEX delivery_evidence_project_order ON delivery_evidence(project_id,received_at DESC,id DESC);
--> statement-breakpoint
CREATE INDEX delivery_evidence_source_object ON delivery_evidence(source_id,kind,external_id,attempt,provider_updated_at DESC);
--> statement-breakpoint
CREATE TABLE delivery_evidence_link (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), evidence_id uuid NOT NULL REFERENCES delivery_evidence(id) ON DELETE RESTRICT,
 work_item_id uuid NOT NULL REFERENCES work_item(id) ON DELETE RESTRICT, created_by uuid REFERENCES member(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT delivery_evidence_link_unique UNIQUE(evidence_id,work_item_id)
);
--> statement-breakpoint
CREATE TABLE delivery_receipt (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid NOT NULL REFERENCES delivery_source(id) ON DELETE RESTRICT,
 source_version integer NOT NULL CHECK(source_version>0), delivery_id text NOT NULL, payload_hash text NOT NULL,
 event_type text NOT NULL, evidence_id uuid NOT NULL REFERENCES delivery_evidence(id) ON DELETE RESTRICT,
 received_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT delivery_receipt_unique UNIQUE(source_id,delivery_id)
);
--> statement-breakpoint
CREATE FUNCTION preserve_delivery_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'delivery evidence is immutable'; END IF;
 IF (to_jsonb(NEW)-'created_by') IS DISTINCT FROM (to_jsonb(OLD)-'created_by') OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL)
 THEN RAISE EXCEPTION 'delivery evidence is immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER delivery_evidence_immutable BEFORE UPDATE OR DELETE ON delivery_evidence FOR EACH ROW EXECUTE FUNCTION preserve_delivery_evidence();
