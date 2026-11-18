CREATE TABLE "intake_form" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"submit_token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"converted_idea_id" uuid,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_submission_status_allowed" CHECK ("intake_submission"."status" IN ('PENDING','CONVERTED','REJECTED'))
);
--> statement-breakpoint
ALTER TABLE "intake_form" ADD CONSTRAINT "intake_form_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_submission" ADD CONSTRAINT "intake_submission_form_id_intake_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."intake_form"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_submission" ADD CONSTRAINT "intake_submission_converted_idea_id_idea_id_fk" FOREIGN KEY ("converted_idea_id") REFERENCES "public"."idea"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "intake_form_submit_token_key" ON "intake_form" USING btree ("submit_token_hash");--> statement-breakpoint
CREATE INDEX "intake_form_project_idx" ON "intake_form" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "intake_submission_form_idx" ON "intake_submission" USING btree ("form_id","created_at");