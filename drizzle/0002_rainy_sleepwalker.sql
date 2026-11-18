CREATE TABLE "invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"project_role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"invited_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"issued_by_member_id" uuid
);
--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_invited_by_member_id_member_id_fk" FOREIGN KEY ("invited_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_issued_by_member_id_member_id_fk" FOREIGN KEY ("issued_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invite_token_hash_key" ON "invite" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invite_email_idx" ON "invite" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_token_hash_key" ON "password_reset_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_token_member_idx" ON "password_reset_token" USING btree ("member_id");