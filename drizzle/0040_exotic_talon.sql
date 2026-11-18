CREATE TABLE "milestone_progress_update" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"milestone_id" uuid NOT NULL,
	"author_id" uuid,
	"summary" text NOT NULL,
	"next_steps" text,
	"blockers" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "milestone_progress_update" ADD CONSTRAINT "milestone_progress_update_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_progress_update" ADD CONSTRAINT "milestone_progress_update_milestone_id_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_progress_update" ADD CONSTRAINT "milestone_progress_update_author_id_member_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "milestone_progress_milestone_idx" ON "milestone_progress_update" USING btree ("milestone_id","created_at");