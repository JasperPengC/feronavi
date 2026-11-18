ALTER TABLE "workflow_transition" ADD COLUMN "requires_approval" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "workflow_transition" ADD COLUMN "approver_role_keys" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
CREATE TABLE "approval_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"from_state_id" uuid NOT NULL,
	"to_state_id" uuid NOT NULL,
	"requested_by" uuid,
	"approver_role_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"comment" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_request_status_allowed" CHECK ("approval_request"."status" IN ('PENDING','APPROVED','REJECTED','CANCELLED'))
);
--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "work_item"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflow"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_from_state_id_workflow_state_id_fk" FOREIGN KEY ("from_state_id") REFERENCES "workflow_state"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_to_state_id_workflow_state_id_fk" FOREIGN KEY ("to_state_id") REFERENCES "workflow_state"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_requested_by_member_id_fk" FOREIGN KEY ("requested_by") REFERENCES "member"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_decided_by_member_id_fk" FOREIGN KEY ("decided_by") REFERENCES "member"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "approval_request_item_idx" ON "approval_request" ("work_item_id","status");
