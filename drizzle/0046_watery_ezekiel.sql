ALTER TABLE "ai_provider_config" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_provider_config" ADD COLUMN "last_test_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_provider_config" ADD COLUMN "last_test_ok" boolean;--> statement-breakpoint
ALTER TABLE "ai_provider_config" ADD COLUMN "last_test_error" text;--> statement-breakpoint
ALTER TABLE "ai_provider_config" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;