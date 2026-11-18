CREATE TABLE "knowledge_query_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid,
	"query_hash" text NOT NULL,
	"citation_count" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"token_usage" integer DEFAULT 0 NOT NULL,
	"project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_query_log" ADD CONSTRAINT "knowledge_query_log_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_query_log" ADD CONSTRAINT "knowledge_query_log_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_query_log_created_idx" ON "knowledge_query_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "knowledge_query_log_project_idx" ON "knowledge_query_log" USING btree ("project_id");