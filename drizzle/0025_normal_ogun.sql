CREATE TABLE "two_factor_secret" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"secret_encrypted" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"recovery_codes_hash" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "two_factor_status_allowed" CHECK ("two_factor_secret"."status" IN ('PENDING','ACTIVE'))
);
--> statement-breakpoint
ALTER TABLE "two_factor_secret" ADD CONSTRAINT "two_factor_secret_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;