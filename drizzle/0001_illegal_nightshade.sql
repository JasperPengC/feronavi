CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"next_issue_number" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status_id" uuid,
	"lifecycle_lock" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"is_secret" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setup_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"initialized_at" timestamp with time zone,
	"current_step" integer
);
--> statement-breakpoint
CREATE TABLE "work_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"workflow_id" uuid NOT NULL,
	"status_id" uuid NOT NULL,
	"parent_id" uuid,
	"assignee_id" uuid,
	"reporter_id" uuid NOT NULL,
	"priority" text,
	"severity" text,
	"estimate_points" numeric(6, 1),
	"estimate_hours" numeric(6, 2),
	"start_date" date,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_status_id_project_status_def_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."project_status_def"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_created_by_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."member"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_membership" ADD CONSTRAINT "project_membership_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_membership" ADD CONSTRAINT "project_membership_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_membership" ADD CONSTRAINT "project_membership_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_status_id_workflow_state_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."workflow_state"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_assignee_id_member_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_reporter_id_member_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."member"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_key_key" ON "project" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "project_membership_unique_key" ON "project_membership" USING btree ("project_id","member_id");--> statement-breakpoint
CREATE INDEX "project_membership_member_idx" ON "project_membership" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_project_number_key" ON "work_item" USING btree ("project_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_key_key" ON "work_item" USING btree ("key");--> statement-breakpoint
CREATE INDEX "work_item_status_idx" ON "work_item" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "work_item_assignee_idx" ON "work_item" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "work_item_project_created_idx" ON "work_item" USING btree ("project_id","created_at");--> statement-breakpoint
-- ═════════════════════════════════════════════════════════════
-- 手写补丁（本段非 drizzle-kit 生成）
--
-- drizzle 表达不了 CHECK 约束与自引用外键，但它们是规范里写死的约束：
--   - 数据模型 3.1 的四条 CHECK（严重度仅缺陷有效、日期顺序、禁止自环、子任务必须有父项）
--   - 数据模型 2.1 的编号溢出防护（A45 明确要求，不能只在应用层判）
--   - work_item.parent_id 的自引用外键（SET NULL）
-- ⚠️ 重跑 generate 会覆盖本段 —— 生成后必须重新补上（见 CONTRIBUTING）。
-- ═════════════════════════════════════════════════════════════

-- 编号溢出防护：number 用 int（上限 21 亿），越界即拒绝而不是静默溢出
ALTER TABLE "project" ADD CONSTRAINT "project_next_issue_number_range"
  CHECK ("next_issue_number" < 2000000000);

-- 严重度只对缺陷有意义。
-- ⚠️ 规范原写 (type <> 'DEFECT') OR (severity IS NULL)，逻辑写反了——
--    它实际禁止缺陷填严重度、却允许任务填。已修正规范并在此采用正确方向。
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_severity_only_defect"
  CHECK (("type" = 'DEFECT') OR ("severity" IS NULL));

-- 起始日期不得晚于截止日期
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_date_order"
  CHECK (("start_date" IS NULL OR "due_date" IS NULL) OR ("start_date" <= "due_date"));

-- 禁止自环
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_no_self_parent"
  CHECK (("parent_id" IS NULL) OR ("parent_id" <> "id"));

-- 子任务必须有父项
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_subtask_needs_parent"
  CHECK (("type" <> 'SUBTASK') OR ("parent_id" IS NOT NULL));

-- 父任务自引用外键（删父项时子项变顶级，不级联删除）
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_parent_fk"
  FOREIGN KEY ("parent_id") REFERENCES "work_item"("id") ON DELETE SET NULL;
