CREATE TABLE "work_item_progress_update" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"author_id" uuid,
	"summary" text NOT NULL,
	"next_steps" text,
	"blockers" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_item_progress_update" ADD CONSTRAINT "work_item_progress_update_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_progress_update" ADD CONSTRAINT "work_item_progress_update_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_progress_update" ADD CONSTRAINT "work_item_progress_update_author_id_member_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_item_progress_item_idx" ON "work_item_progress_update" USING btree ("work_item_id","created_at");