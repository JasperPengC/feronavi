CREATE TABLE "system_backup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by" uuid,
	"mode" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"header_draft" jsonb NOT NULL,
	"package_path" text,
	"bytes" bigint,
	"manifest_summary" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_backup_mode_check" CHECK ("system_backup"."mode" in ('safe','full')),
	CONSTRAINT "system_backup_status_check" CHECK ("system_backup"."status" in ('PENDING','RUNNING','SUCCEEDED','FAILED'))
);
--> statement-breakpoint
CREATE TABLE "system_restore" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid,
	"status" text DEFAULT 'UPLOADED' NOT NULL,
	"upload_path" text NOT NULL,
	"mode" text,
	"source_version" text,
	"manifest_summary" jsonb,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "system_restore_status_check" CHECK ("system_restore"."status" in ('UPLOADED','PREFLIGHT_PASSED','RESTORING','SUCCEEDED','FAILED'))
);
--> statement-breakpoint
ALTER TABLE "system_backup" ADD CONSTRAINT "system_backup_requested_by_member_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "system_backup_requested_idx" ON "system_backup" USING btree ("requested_by","created_at");
