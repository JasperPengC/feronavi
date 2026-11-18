CREATE TABLE "focus_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"time_block_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"actual_minutes" integer NOT NULL,
	"note" text,
	CONSTRAINT "focus_session_range_valid" CHECK ("focus_session"."ended_at" > "focus_session"."started_at"),
	CONSTRAINT "focus_session_minutes_valid" CHECK ("focus_session"."actual_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "time_block" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"title" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"project_id" uuid,
	"work_item_id" uuid,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_block_range_valid" CHECK ("time_block"."end_at" > "time_block"."start_at")
);
--> statement-breakpoint
ALTER TABLE "focus_session" ADD CONSTRAINT "focus_session_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_session" ADD CONSTRAINT "focus_session_time_block_id_time_block_id_fk" FOREIGN KEY ("time_block_id") REFERENCES "public"."time_block"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_block" ADD CONSTRAINT "time_block_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_block" ADD CONSTRAINT "time_block_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_block" ADD CONSTRAINT "time_block_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "focus_session_block_started" ON "focus_session" USING btree ("time_block_id","started_at");--> statement-breakpoint
CREATE INDEX "focus_session_member_started_idx" ON "focus_session" USING btree ("member_id","started_at");--> statement-breakpoint
CREATE INDEX "time_block_member_start_idx" ON "time_block" USING btree ("member_id","start_at");--> statement-breakpoint
CREATE INDEX "time_block_project_start_idx" ON "time_block" USING btree ("project_id","start_at");