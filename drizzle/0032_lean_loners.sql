CREATE TABLE "mcp_client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" uuid NOT NULL,
	"client_name" text,
	"client_version" text,
	"last_seen_at" timestamp with time zone,
	"call_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_tool_policy" (
	"token_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"effect" text NOT NULL,
	"arg_constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "mcp_tool_policy_token_id_tool_name_pk" PRIMARY KEY("token_id","tool_name"),
	CONSTRAINT "mcp_tool_policy_effect_allowed" CHECK ("mcp_tool_policy"."effect" IN ('ALLOW','DENY'))
);
--> statement-breakpoint
ALTER TABLE "mcp_client" ADD CONSTRAINT "mcp_client_token_id_api_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_token"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_policy" ADD CONSTRAINT "mcp_tool_policy_token_id_api_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_token"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_client_token_key" ON "mcp_client" USING btree ("token_id");