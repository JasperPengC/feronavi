CREATE TABLE "integration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"token_encrypted" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_kind_allowed" CHECK ("integration"."kind" IN ('GITLAB','GITHUB','GITEE'))
);
--> statement-breakpoint
CREATE TABLE "sync_cursor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"cursor" text,
	"last_synced_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_cursor" ADD CONSTRAINT "sync_cursor_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_kind_project_url_key" ON "integration" USING btree ("kind","project_id","base_url");--> statement-breakpoint
CREATE INDEX "integration_project_idx" ON "integration" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_cursor_integration_entity_key" ON "sync_cursor" USING btree ("integration_id","entity");