CREATE TABLE "automation_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"trigger" text NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_rule_trigger_allowed" CHECK ("automation_rule"."trigger" IN ('WORK_ITEM_CREATED','WORK_ITEM_UPDATED','STATUS_CHANGED','COMMENT_ADDED','SLA_BREACHED'))
);
--> statement-breakpoint
CREATE TABLE "automation_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"work_item_id" uuid,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_run_status_allowed" CHECK ("automation_run"."status" IN ('SUCCESS','SKIPPED','FAILED'))
);
--> statement-breakpoint
CREATE TABLE "scim_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"created_by" uuid,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sla_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" text,
	"severity" text,
	"type" text,
	"response_minutes" integer NOT NULL,
	"resolve_minutes" integer NOT NULL,
	"escalate_after_minutes" integer DEFAULT 60 NOT NULL,
	"escalate_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_item_sla" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"policy_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_response_at" timestamp with time zone,
	"response_due_at" timestamp with time zone NOT NULL,
	"resolve_due_at" timestamp with time zone NOT NULL,
	"breached_at" timestamp with time zone,
	"state" text DEFAULT 'ACTIVE' NOT NULL,
	"last_escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_sla_state_allowed" CHECK ("work_item_sla"."state" IN ('ACTIVE','MET','BREACHED','CANCELLED'))
);
--> statement-breakpoint
ALTER TABLE "idp_config" ADD COLUMN "config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_created_by_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_rule_id_automation_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_token" ADD CONSTRAINT "scim_token_created_by_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_policy" ADD CONSTRAINT "sla_policy_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_sla" ADD CONSTRAINT "work_item_sla_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_sla" ADD CONSTRAINT "work_item_sla_policy_id_sla_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."sla_policy"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_rule_project_idx" ON "automation_rule" USING btree ("project_id","enabled");--> statement-breakpoint
CREATE INDEX "automation_run_rule_idx" ON "automation_run" USING btree ("rule_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_run_item_idx" ON "automation_run" USING btree ("work_item_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_token_hash_key" ON "scim_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sla_policy_project_idx" ON "sla_policy" USING btree ("project_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_sla_item_key" ON "work_item_sla" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "work_item_sla_due_idx" ON "work_item_sla" USING btree ("state","response_due_at");--> statement-breakpoint
