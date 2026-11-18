CREATE TABLE "attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"uploader_id" uuid NOT NULL,
	"original_name" text NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"parent_id" uuid,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mention" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"actor_id" uuid,
	"type" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"read_at" timestamp with time zone,
	"group_key" text,
	"item_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"category_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dnd_start" time,
	"dnd_end" time,
	"dnd_timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"digest_frequency" text DEFAULT 'OFF' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"notify_channel" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_uploader_id_member_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."member"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_author_id_member_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."member"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention" ADD CONSTRAINT "mention_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_id_member_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_id_member_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_target_idx" ON "attachment" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "attachment_hash_idx" ON "attachment" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "comment_target_idx" ON "comment" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mention_unique_key" ON "mention" USING btree ("source_type","source_id","member_id");--> statement-breakpoint
CREATE INDEX "notification_recipient_idx" ON "notification" USING btree ("recipient_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "notification_group_idx" ON "notification" USING btree ("group_key");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_unique_key" ON "subscription" USING btree ("member_id","target_type","target_id","notify_channel");--> statement-breakpoint
CREATE INDEX "subscription_target_idx" ON "subscription" USING btree ("target_type","target_id");--> statement-breakpoint
-- ═════════════════════════════════════════════════════════════
-- 手写补丁（本段非 drizzle-kit 生成）
--
-- 第三期表的 CHECK —— drizzle 的 schema 定义表达不了，必须手写。
-- 依据 `数据模型-完整定义.md` 第 7.1–7.4 节。
-- ⚠️ 重跑 generate 会覆盖本段 —— 生成后必须重新补上（见 CONTRIBUTING）。
-- ═════════════════════════════════════════════════════════════

-- 评论不能自引用
ALTER TABLE "comment" ADD CONSTRAINT "comment_no_self_parent"
  CHECK ("parent_id" IS NULL OR "parent_id" <> "id");

-- 评论自引用外键（删父评论时级联删回复）
ALTER TABLE "comment" ADD CONSTRAINT "comment_parent_fk"
  FOREIGN KEY ("parent_id") REFERENCES "comment"("id") ON DELETE CASCADE;

-- 附件大小：> 0 且不超过 1GB（DB 层硬上限，防御性）。
-- ⚠️ 25MB 只是**应用层默认上限**，可由部署者调高，故不写进 CHECK。
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_size_range"
  CHECK ("size_bytes" > 0 AND "size_bytes" <= 1073741824);

-- 免打扰：起始与截止要么都填、要么都不填（半套配置没有意义）
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_dnd_pair"
  CHECK (("dnd_start" IS NULL) = ("dnd_end" IS NULL));
