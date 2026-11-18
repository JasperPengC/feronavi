CREATE TABLE "ai_provider_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"base_url" text NOT NULL,
	"model" text NOT NULL,
	"embedding_model" text NOT NULL,
	"api_key_encrypted" text,
	"scope" text DEFAULT 'PAGE' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_provider_allowed" CHECK ("ai_provider_config"."provider" IN ('OPENAI_COMPAT','OLLAMA')),
	CONSTRAINT "ai_provider_scope_allowed" CHECK ("ai_provider_config"."scope" = 'PAGE')
);
--> statement-breakpoint
CREATE TABLE "ai_usage_counter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"period" text NOT NULL,
	"period_start" date NOT NULL,
	"embedding_tokens" bigint DEFAULT 0 NOT NULL,
	"embedding_calls" integer DEFAULT 0 NOT NULL,
	"query_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_period_allowed" CHECK ("ai_usage_counter"."period" IN ('DAY','MONTH'))
);
--> statement-breakpoint
ALTER TABLE "ai_usage_counter" ADD CONSTRAINT "ai_usage_counter_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_usage_member_period_key" ON "ai_usage_counter" USING btree ("member_id","period","period_start");