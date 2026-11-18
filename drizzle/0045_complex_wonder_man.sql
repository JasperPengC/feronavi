CREATE TABLE "im_channel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"webhook_url_encrypted" text,
	"app_key_encrypted" text,
	"app_secret_encrypted" text,
	"corp_id" text,
	"agent_id" text,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_test_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_error" text,
	"last_send_at" timestamp with time zone,
	"last_send_ok" boolean,
	"last_send_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "im_channel_provider_allowed" CHECK ("im_channel"."provider" IN ('DINGTALK','WECOM','FEISHU'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "im_channel_provider_name_key" ON "im_channel" USING btree ("provider","name");