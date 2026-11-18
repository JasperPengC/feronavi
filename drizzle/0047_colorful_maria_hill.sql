CREATE TABLE "work_item_transfer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"from_assignee_id" uuid,
	"to_assignee_id" uuid,
	"actor_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_item_transfer" ADD CONSTRAINT "work_item_transfer_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_transfer" ADD CONSTRAINT "work_item_transfer_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_transfer" ADD CONSTRAINT "work_item_transfer_from_assignee_id_member_id_fk" FOREIGN KEY ("from_assignee_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_transfer" ADD CONSTRAINT "work_item_transfer_to_assignee_id_member_id_fk" FOREIGN KEY ("to_assignee_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_transfer" ADD CONSTRAINT "work_item_transfer_actor_id_member_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_item_transfer_item_idx" ON "work_item_transfer" USING btree ("work_item_id","created_at");