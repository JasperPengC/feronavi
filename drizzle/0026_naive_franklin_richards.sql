CREATE TABLE "idp_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_encrypted" text,
	"auto_provision" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"allowed_email_domains" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idp_kind_allowed" CHECK ("idp_config"."kind" IN ('OIDC','LDAP'))
);
--> statement-breakpoint
CREATE TABLE "sso_login_state" (
	"state" text PRIMARY KEY NOT NULL,
	"idp_config_id" uuid NOT NULL,
	"nonce" text NOT NULL,
	"code_verifier" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sso_login_state" ADD CONSTRAINT "sso_login_state_idp_config_id_idp_config_id_fk" FOREIGN KEY ("idp_config_id") REFERENCES "public"."idp_config"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idp_issuer_client_key" ON "idp_config" USING btree ("issuer","client_id");