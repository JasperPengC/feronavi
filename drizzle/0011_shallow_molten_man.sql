CREATE TABLE "custom_field_def" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_states" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_def_type_allowed" CHECK ("custom_field_def"."type" IN ('TEXT','NUMBER','DATE','SINGLE_SELECT','MULTI_SELECT','PERSON'))
);
--> statement-breakpoint
CREATE TABLE "custom_field_value" (
	"work_item_id" uuid PRIMARY KEY NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_field_def" ADD CONSTRAINT "custom_field_def_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_def_project_key" ON "custom_field_def" USING btree ("project_id","key");--> statement-breakpoint
CREATE INDEX "custom_field_def_project_idx" ON "custom_field_def" USING btree ("project_id");