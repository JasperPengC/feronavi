CREATE TABLE "announcement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"severity" text DEFAULT 'INFO' NOT NULL,
	"audience" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcement_severity_allowed" CHECK ("announcement"."severity" IN ('INFO','WARNING','CRITICAL'))
);
--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_author_id_member_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."member"("id") ON DELETE restrict ON UPDATE no action;