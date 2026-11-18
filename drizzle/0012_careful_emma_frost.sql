CREATE TABLE "import_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"source" text NOT NULL,
	"filename" text,
	"status" text NOT NULL,
	"mapping_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_report" jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "import_batch_source_allowed" CHECK ("import_batch"."source" IN ('CSV','EXCEL','ZENTAO_API','JIRA_API')),
	CONSTRAINT "import_batch_status_allowed" CHECK ("import_batch"."status" IN ('DRY_RUN','PENDING_CONFIRM','RUNNING','SUCCEEDED','PARTIAL','FAILED','ROLLED_BACK'))
);
--> statement-breakpoint
CREATE TABLE "import_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"external_id" text NOT NULL,
	"internal_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_mapping_entity_allowed" CHECK ("import_mapping"."entity" IN ('WORK_ITEM','MILESTONE','ITERATION','RELEASE','MODULE','USER'))
);
--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_created_by_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."member"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mapping" ADD CONSTRAINT "import_mapping_batch_id_import_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mapping" ADD CONSTRAINT "import_mapping_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_batch_project_status_idx" ON "import_batch" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "import_batch_status_created_idx" ON "import_batch" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_mapping_entity_external_project" ON "import_mapping" USING btree ("entity","external_id","project_id");--> statement-breakpoint
CREATE INDEX "import_mapping_batch_entity_idx" ON "import_mapping" USING btree ("batch_id","entity");