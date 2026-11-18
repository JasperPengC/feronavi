CREATE TABLE "idea" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'NEW' NOT NULL,
	"submitted_by_member_id" uuid,
	"submitter_display" text,
	"promoted_work_item_id" uuid,
	"score" numeric(10, 2) DEFAULT '0' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idea_status_allowed" CHECK ("idea"."status" IN ('NEW','UNDER_REVIEW','PLANNED','REJECTED')),
	CONSTRAINT "idea_has_submitter" CHECK ("idea"."submitted_by_member_id" IS NOT NULL OR "idea"."submitter_display" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "idea_vote" (
	"idea_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idea_vote_idea_id_member_id_pk" PRIMARY KEY("idea_id","member_id"),
	CONSTRAINT "idea_vote_weight_range" CHECK ("idea_vote"."weight" BETWEEN -1 AND 5)
);
--> statement-breakpoint
ALTER TABLE "idea" ADD CONSTRAINT "idea_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea" ADD CONSTRAINT "idea_submitted_by_member_id_member_id_fk" FOREIGN KEY ("submitted_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea" ADD CONSTRAINT "idea_promoted_work_item_id_work_item_id_fk" FOREIGN KEY ("promoted_work_item_id") REFERENCES "public"."work_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_vote" ADD CONSTRAINT "idea_vote_idea_id_idea_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."idea"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_vote" ADD CONSTRAINT "idea_vote_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idea_project_status_score_idx" ON "idea" USING btree ("project_id","status","score");--> statement-breakpoint
CREATE INDEX "idea_vote_member_idx" ON "idea_vote" USING btree ("member_id");