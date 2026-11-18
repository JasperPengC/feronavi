CREATE TABLE "department" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"department_id" uuid,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "position_id" uuid;--> statement-breakpoint
ALTER TABLE "position" ADD CONSTRAINT "position_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "department_parent_name_key" ON "department" USING btree ("parent_id","name");--> statement-breakpoint
CREATE INDEX "department_parent_idx" ON "department" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "position_name_key" ON "position" USING btree ("name");--> statement-breakpoint
CREATE INDEX "position_department_idx" ON "position" USING btree ("department_id");--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_position_id_position_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."position"("id") ON DELETE set null ON UPDATE no action;