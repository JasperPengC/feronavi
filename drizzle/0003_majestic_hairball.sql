CREATE TABLE "iteration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"completed_at" timestamp with time zone,
	"carry_over" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iteration_capacity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"iteration_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"capacity_points" numeric(6, 1),
	"capacity_hours" numeric(6, 2),
	"logged_points" numeric(6, 1) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"start_date" date,
	"due_date" date,
	"progress_mode" text DEFAULT 'COUNT' NOT NULL,
	"progress_value" numeric(5, 2),
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "module" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"archived_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "release" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version_tag" text,
	"release_date" date,
	"completed_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_view" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"project_id" uuid,
	"view_type" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sorts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_item" ADD COLUMN "milestone_id" uuid;--> statement-breakpoint
ALTER TABLE "work_item" ADD COLUMN "iteration_id" uuid;--> statement-breakpoint
ALTER TABLE "work_item" ADD COLUMN "release_id" uuid;--> statement-breakpoint
ALTER TABLE "work_item" ADD COLUMN "module_id" uuid;--> statement-breakpoint
ALTER TABLE "iteration" ADD CONSTRAINT "iteration_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iteration_capacity" ADD CONSTRAINT "iteration_capacity_iteration_id_iteration_id_fk" FOREIGN KEY ("iteration_id") REFERENCES "public"."iteration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iteration_capacity" ADD CONSTRAINT "iteration_capacity_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module" ADD CONSTRAINT "module_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release" ADD CONSTRAINT "release_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_owner_id_member_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "iteration_project_idx" ON "iteration" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "iteration_capacity_unique_key" ON "iteration_capacity" USING btree ("iteration_id","member_id");--> statement-breakpoint
CREATE INDEX "milestone_project_idx" ON "milestone" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "module_parent_name_key" ON "module" USING btree ("parent_id","name");--> statement-breakpoint
CREATE INDEX "module_project_idx" ON "module" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "release_project_name_key" ON "release" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "saved_view_owner_idx" ON "saved_view" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_milestone_id_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestone"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_iteration_id_iteration_id_fk" FOREIGN KEY ("iteration_id") REFERENCES "public"."iteration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_release_id_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."release"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_module_id_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."module"("id") ON DELETE set null ON UPDATE no action;

--> statement-breakpoint
-- ═════════════════════════════════════════════════════════════
-- 手写补丁（本段非 drizzle-kit 生成）
--
-- 第二期新增表的 CHECK 约束 —— drizzle 的 schema 定义表达不了，必须手写。
-- 依据 `数据模型-完整定义.md` 第 4.1–4.4、2.5 节。
-- ⚠️ 重跑 generate 会覆盖本段 —— 生成后必须重新补上（见 CONTRIBUTING）。
-- ═════════════════════════════════════════════════════════════

-- milestone：日期顺序
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_date_order"
  CHECK ("start_date" IS NULL OR "due_date" IS NULL OR "start_date" <= "due_date");

-- milestone：手动进度必须且仅有 MANUAL 模式使用 progress_value
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_manual_progress"
  CHECK (("progress_mode" = 'MANUAL') = ("progress_value" IS NOT NULL));

-- milestone：进度值范围 0–100
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_progress_range"
  CHECK ("progress_value" IS NULL OR ("progress_value" >= 0 AND "progress_value" <= 100));

-- iteration：起止必填且有序
ALTER TABLE "iteration" ADD CONSTRAINT "iteration_date_order"
  CHECK ("start_date" <= "end_date");

-- iteration_capacity：点数与工时**二选一**（不允许同时为空或同时有值）
ALTER TABLE "iteration_capacity" ADD CONSTRAINT "iteration_capacity_one_of"
  CHECK (("capacity_points" IS NULL) <> ("capacity_hours" IS NULL));

-- saved_view：PROJECT_SHARED 必须带 project_id，PERSONAL 则不应带
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_shared_needs_project"
  CHECK ("scope" <> 'PROJECT_SHARED' OR "project_id" IS NOT NULL);
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_personal_no_project"
  CHECK ("scope" <> 'PERSONAL' OR "project_id" IS NULL);

-- module：自引用外键（删父模块时子模块变顶级）
ALTER TABLE "module" ADD CONSTRAINT "module_parent_fk"
  FOREIGN KEY ("parent_id") REFERENCES "module"("id") ON DELETE SET NULL;
