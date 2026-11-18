CREATE TABLE "page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"parent_id" uuid,
	"visibility" text DEFAULT 'PROJECT' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"search_vector" tsvector,
	"current_revision_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_visibility_allowed" CHECK ("page"."visibility" IN ('PROJECT','RESTRICTED'))
);
--> statement-breakpoint
CREATE TABLE "page_permission" (
	"page_id" uuid NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"can_read" boolean DEFAULT false NOT NULL,
	"can_write" boolean DEFAULT false NOT NULL,
	CONSTRAINT "page_permission_page_id_principal_type_principal_id_pk" PRIMARY KEY("page_id","principal_type","principal_id"),
	CONSTRAINT "page_permission_principal_allowed" CHECK ("page_permission"."principal_type" IN ('MEMBER','TEAM','ROLE'))
);
--> statement-breakpoint
CREATE TABLE "page_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"content" text NOT NULL,
	"change_summary" text,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_parent_id_page_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."page"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_current_revision_id_page_revision_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."page_revision"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_permission" ADD CONSTRAINT "page_permission_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_revision" ADD CONSTRAINT "page_revision_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_revision" ADD CONSTRAINT "page_revision_author_id_member_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."member"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "page_project_slug_key" ON "page" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "page_project_parent_idx" ON "page" USING btree ("project_id","parent_id");--> statement-breakpoint
CREATE INDEX "page_permission_principal_idx" ON "page_permission" USING btree ("principal_type","principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "page_revision_page_no_key" ON "page_revision" USING btree ("page_id","revision_no");
--> statement-breakpoint
-- tsvector 的 GIN 索引 drizzle 表达不了，按规范手写（内容在 page_revision，本列是派生值）
CREATE INDEX IF NOT EXISTS "page_search_vector_idx" ON "page" USING gin ("search_vector");
