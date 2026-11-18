CREATE TABLE "chunk_embedding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chunk_id" uuid NOT NULL,
	"model" text NOT NULL,
	"vector" vector(1024) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "index_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid,
	"mode" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"error_message" text,
	"heartbeat_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "index_job_mode_allowed" CHECK ("index_job"."mode" IN ('INCREMENTAL','FULL','REEMBED')),
	CONSTRAINT "index_job_status_allowed" CHECK ("index_job"."status" IN ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "page_chunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"heading_path" text,
	"content" text NOT NULL,
	"token_count" integer NOT NULL,
	"content_hash" text NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunk_embedding" ADD CONSTRAINT "chunk_embedding_chunk_id_page_chunk_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."page_chunk"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_job" ADD CONSTRAINT "index_job_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_chunk" ADD CONSTRAINT "page_chunk_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_chunk" ADD CONSTRAINT "page_chunk_revision_id_page_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."page_revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunk_embedding_chunk_idx" ON "chunk_embedding" USING btree ("chunk_id");--> statement-breakpoint
CREATE INDEX "index_job_status_idx" ON "index_job" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "index_job_page_idx" ON "index_job" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "page_chunk_page_generation_idx" ON "page_chunk" USING btree ("page_id","generation");--> statement-breakpoint
CREATE INDEX "page_chunk_hash_idx" ON "page_chunk" USING btree ("content_hash");
--> statement-breakpoint
-- 向量近邻检索用 HNSW 索引（drizzle 表达不了）；维度固定 1024，与模型维度校验呼应
CREATE INDEX IF NOT EXISTS "chunk_embedding_hnsw_idx" ON "chunk_embedding" USING hnsw ("vector" vector_cosine_ops);
