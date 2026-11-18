CREATE TABLE "dashboard" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_widget" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dashboard_id" uuid NOT NULL,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_widget_type_allowed" CHECK ("dashboard_widget"."type" IN ('BURNDOWN','CUMULATIVE_FLOW','ACTIVITY_HEATMAP','PIE','LIST','COUNT'))
);
--> statement-breakpoint
CREATE TABLE "metric_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"iteration_id" uuid NOT NULL,
	"member_id" uuid,
	"snapshot_date" date NOT NULL,
	"scope_points" numeric(8, 1) DEFAULT '0' NOT NULL,
	"done_points" numeric(8, 1) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dashboard" ADD CONSTRAINT "dashboard_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard" ADD CONSTRAINT "dashboard_owner_id_member_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_widget" ADD CONSTRAINT "dashboard_widget_dashboard_id_dashboard_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboard"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshot" ADD CONSTRAINT "metric_snapshot_iteration_id_iteration_id_fk" FOREIGN KEY ("iteration_id") REFERENCES "public"."iteration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshot" ADD CONSTRAINT "metric_snapshot_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dashboard_owner_idx" ON "dashboard" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "dashboard_project_idx" ON "dashboard" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "dashboard_widget_dashboard_idx" ON "dashboard_widget" USING btree ("dashboard_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_snapshot_iteration_member_date" ON "metric_snapshot" USING btree ("iteration_id","member_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "metric_snapshot_iteration_date_idx" ON "metric_snapshot" USING btree ("iteration_id","snapshot_date");