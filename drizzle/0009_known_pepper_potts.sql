CREATE TABLE "member_preference" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"locale" text DEFAULT 'zh-CN' NOT NULL,
	"timezone" text,
	"density" text DEFAULT 'comfortable' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"logged_date" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_item_collaborator" (
	"work_item_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_collaborator_work_item_id_member_id_pk" PRIMARY KEY("work_item_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "work_item_relation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_preference" ADD CONSTRAINT "member_preference_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_log" ADD CONSTRAINT "time_log_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_log" ADD CONSTRAINT "time_log_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_collaborator" ADD CONSTRAINT "work_item_collaborator_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_collaborator" ADD CONSTRAINT "work_item_collaborator_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_relation" ADD CONSTRAINT "work_item_relation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_relation" ADD CONSTRAINT "work_item_relation_source_id_work_item_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_relation" ADD CONSTRAINT "work_item_relation_target_id_work_item_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_log_item_idx" ON "time_log" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "time_log_member_date_idx" ON "time_log" USING btree ("member_id","logged_date");--> statement-breakpoint
CREATE INDEX "work_item_collaborator_member_idx" ON "work_item_collaborator" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_relation_unique_key" ON "work_item_relation" USING btree ("source_id","target_id","type");--> statement-breakpoint
CREATE INDEX "work_item_relation_target_idx" ON "work_item_relation" USING btree ("target_id","type");--> statement-breakpoint
-- 手写补丁（数据模型 3.3 / 3.5 明确要求）
ALTER TABLE "work_item_relation" ADD CONSTRAINT "work_item_relation_type_allowed"
  CHECK ("type" IN ('BLOCKS','BLOCKED_BY','RELATES_TO','DUPLICATES'));
ALTER TABLE "work_item_relation" ADD CONSTRAINT "work_item_relation_no_self"
  CHECK ("source_id" <> "target_id");
ALTER TABLE "time_log" ADD CONSTRAINT "time_log_minutes_positive"
  CHECK ("minutes" > 0);
ALTER TABLE "member_preference" ADD CONSTRAINT "member_preference_theme_allowed"
  CHECK ("theme" IN ('dark','light','system'));
ALTER TABLE "member_preference" ADD CONSTRAINT "member_preference_density_allowed"
  CHECK ("density" IN ('comfortable','compact'));
