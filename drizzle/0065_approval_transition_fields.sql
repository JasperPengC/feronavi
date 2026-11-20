ALTER TABLE "approval_request" ADD COLUMN "transition_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;
