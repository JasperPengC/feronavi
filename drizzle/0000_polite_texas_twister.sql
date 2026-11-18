-- ═════════════════════════════════════════════════════════════
-- 手写补丁（本段非 drizzle-kit 生成）
--
-- 扩展必须在业务表之前建好。为什么不能只靠镜像的 initdb 脚本：
--   /docker-entrypoint-initdb.d/10-extensions.sql **只在全新数据卷上跑一次**，
--   已有实例（升级、schema 重建）拿不到扩展；而扩展属于 schema，会随 schema 一起消失。
--   实测：drop schema public cascade 之后重跑 compose，只剩 plpgsql。
--
-- ⚠️ 重跑 generate 会覆盖本段 —— 生成后必须重新补上（见 CONTRIBUTING）。
-- ═════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS zhparser;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'chinese_zh') THEN
        CREATE TEXT SEARCH CONFIGURATION chinese_zh (PARSER = zhparser);
        ALTER TEXT SEARCH CONFIGURATION chinese_zh
            ADD MAPPING FOR n,v,a,i,e,l,j WITH simple;
    END IF;
END
$$;
--> statement-breakpoint
CREATE TABLE "api_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"tier" text NOT NULL,
	"project_whitelist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_ip_cidrs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"anonymized_at" timestamp with time zone,
	"password_hash" text NOT NULL,
	"timezone" text,
	"locale" text DEFAULT 'zh-CN' NOT NULL,
	"last_login_at" timestamp with time zone,
	"is_initial_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"logo_url" text,
	"default_locale" text DEFAULT 'zh-CN' NOT NULL,
	"default_timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permission" (
	"key" text PRIMARY KEY NOT NULL,
	"group" text NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_status_def" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"color" text DEFAULT 'neutral' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid
);
--> statement-breakpoint
CREATE TABLE "role_permission" (
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "role_permission_role_id_permission_key_pk" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"ip" text,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"applies_to_type" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"color" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_transition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"from_state_id" uuid NOT NULL,
	"to_state_id" uuid NOT NULL,
	"allowed_role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"label" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_token" ADD CONSTRAINT "api_token_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_key_permission_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permission"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_state" ADD CONSTRAINT "workflow_state_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_transition" ADD CONSTRAINT "workflow_transition_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_transition" ADD CONSTRAINT "workflow_transition_from_state_id_workflow_state_id_fk" FOREIGN KEY ("from_state_id") REFERENCES "public"."workflow_state"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_transition" ADD CONSTRAINT "workflow_transition_to_state_id_workflow_state_id_fk" FOREIGN KEY ("to_state_id") REFERENCES "public"."workflow_state"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_token_hash_key" ON "api_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_token_member_idx" ON "api_token" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_username_key" ON "member" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "member_email_key" ON "member" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "project_status_def_key_key" ON "project_status_def" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "role_key_key" ON "role" USING btree ("key");--> statement-breakpoint
CREATE INDEX "role_assignment_member_idx" ON "role_assignment" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_assignment_unique_key" ON "role_assignment" USING btree ("member_id","role_id","scope_type","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_hash_key" ON "session" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "session_member_idx" ON "session" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "session_expires_idx" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "team_parent_name_key" ON "team" USING btree ("parent_id","name");--> statement-breakpoint
CREATE INDEX "team_parent_idx" ON "team" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_default_per_type_key" ON "workflow" USING btree ("project_id","applies_to_type") WHERE "workflow"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_platform_template_key" ON "workflow" USING btree ("applies_to_type") WHERE "workflow"."project_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_state_key_key" ON "workflow_state" USING btree ("workflow_id","key");--> statement-breakpoint
CREATE INDEX "workflow_state_wf_category_idx" ON "workflow_state" USING btree ("workflow_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_transition_edge_key" ON "workflow_transition" USING btree ("workflow_id","from_state_id","to_state_id");--> statement-breakpoint
CREATE INDEX "workflow_transition_from_idx" ON "workflow_transition" USING btree ("from_state_id");