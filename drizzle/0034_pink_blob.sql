CREATE TABLE "work_item_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	CONSTRAINT "work_item_link_source_type_allowed" CHECK ("work_item_link"."source_type" IN ('WORK_ITEM','IDEA','PAGE','MILESTONE','ITERATION')),
	CONSTRAINT "work_item_link_target_type_allowed" CHECK ("work_item_link"."target_type" IN ('WORK_ITEM','IDEA','PAGE','MILESTONE','ITERATION')),
	CONSTRAINT "work_item_link_no_self" CHECK (NOT ("work_item_link"."source_type" = 'WORK_ITEM' AND "work_item_link"."target_type" = 'WORK_ITEM' AND "work_item_link"."source_id" = "work_item_link"."target_id"))
);
--> statement-breakpoint
CREATE INDEX "work_item_link_source_idx" ON "work_item_link" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "work_item_link_target_idx" ON "work_item_link" USING btree ("target_type","target_id");