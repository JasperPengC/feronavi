CREATE TABLE "dev_activity_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"date" date NOT NULL,
	"commits" integer DEFAULT 0 NOT NULL,
	"prs" integer DEFAULT 0 NOT NULL,
	"reviews" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag_consent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_config_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"purpose_text_snapshot" text NOT NULL,
	"cross_border" boolean NOT NULL,
	"cross_border_path" text,
	"pia_record" jsonb,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "skill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"applies_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dev_activity_daily" ADD CONSTRAINT "dev_activity_daily_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_consent" ADD CONSTRAINT "rag_consent_provider_config_id_ai_provider_config_id_fk" FOREIGN KEY ("provider_config_id") REFERENCES "public"."ai_provider_config"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_consent" ADD CONSTRAINT "rag_consent_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dev_activity_member_date_key" ON "dev_activity_daily" USING btree ("member_id","date");--> statement-breakpoint
CREATE INDEX "dev_activity_date_idx" ON "dev_activity_daily" USING btree ("date");--> statement-breakpoint
CREATE INDEX "rag_consent_member_idx" ON "rag_consent" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "rag_consent_provider_idx" ON "rag_consent" USING btree ("provider_config_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_name_key" ON "skill" USING btree ("name");--> statement-breakpoint
CREATE INDEX "skill_enabled_idx" ON "skill" USING btree ("enabled");