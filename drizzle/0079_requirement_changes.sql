CREATE TABLE requirement_change (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 work_item_id uuid NOT NULL REFERENCES work_item(id) ON DELETE RESTRICT,
 project_id uuid NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
 number integer NOT NULL,
 base_revision_id uuid NOT NULL REFERENCES requirement_revision(id) ON DELETE RESTRICT,
 requested_work_item_version integer NOT NULL,
 proposed_title text NOT NULL, proposed_description text, reason text NOT NULL,
 impact_fingerprint text NOT NULL,
 status text NOT NULL DEFAULT 'PENDING', version integer NOT NULL DEFAULT 1,
 requested_by uuid REFERENCES member(id) ON DELETE SET NULL,
 decided_by uuid REFERENCES member(id) ON DELETE SET NULL, decided_at timestamptz, review_note text,
 cancelled_by uuid REFERENCES member(id) ON DELETE SET NULL, cancelled_at timestamptz, cancel_note text,
 applied_by uuid REFERENCES member(id) ON DELETE SET NULL, applied_at timestamptz,
 applied_revision_id uuid REFERENCES requirement_revision(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT requirement_change_number_key UNIQUE(work_item_id, number),
 CONSTRAINT requirement_change_status CHECK(status IN ('PENDING','APPROVED','REJECTED','CANCELLED','APPLIED')),
 CONSTRAINT requirement_change_positive CHECK(number>0 AND version>0 AND requested_work_item_version>0),
 CONSTRAINT requirement_change_applied CHECK((status='APPLIED') = (applied_at IS NOT NULL AND applied_revision_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE requirement_change_impact (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 change_id uuid NOT NULL REFERENCES requirement_change(id) ON DELETE CASCADE,
 kind text NOT NULL, target_id uuid NOT NULL, snapshot jsonb NOT NULL,
 acknowledged_by uuid REFERENCES member(id) ON DELETE SET NULL, acknowledged_at timestamptz, note text,
 CONSTRAINT requirement_change_impact_target_key UNIQUE(change_id,kind,target_id),
 CONSTRAINT requirement_change_impact_kind CHECK(kind IN ('WORK_ITEM','MILESTONE','ITERATION','RELEASE'))
);
--> statement-breakpoint
CREATE FUNCTION preserve_requirement_change_proposal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.work_item_id,NEW.project_id,NEW.number,NEW.base_revision_id,NEW.requested_work_item_version,NEW.proposed_title,NEW.proposed_description,NEW.reason,NEW.impact_fingerprint,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.work_item_id,OLD.project_id,OLD.number,OLD.base_revision_id,OLD.requested_work_item_version,OLD.proposed_title,OLD.proposed_description,OLD.reason,OLD.impact_fingerprint,OLD.created_at)
 THEN RAISE EXCEPTION 'requirement change proposal is immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER requirement_change_immutable BEFORE UPDATE ON requirement_change FOR EACH ROW EXECUTE FUNCTION preserve_requirement_change_proposal();
--> statement-breakpoint
CREATE FUNCTION preserve_requirement_change_impact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.change_id,NEW.kind,NEW.target_id,NEW.snapshot) IS DISTINCT FROM ROW(OLD.change_id,OLD.kind,OLD.target_id,OLD.snapshot)
 THEN RAISE EXCEPTION 'requirement change impact is immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER requirement_change_impact_immutable BEFORE UPDATE ON requirement_change_impact FOR EACH ROW EXECUTE FUNCTION preserve_requirement_change_impact();
