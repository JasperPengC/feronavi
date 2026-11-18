CREATE TABLE "portfolio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_project" (
	"portfolio_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	CONSTRAINT "portfolio_project_portfolio_id_project_id_pk" PRIMARY KEY("portfolio_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "portfolio" ADD CONSTRAINT "portfolio_owner_id_member_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_project" ADD CONSTRAINT "portfolio_project_portfolio_id_portfolio_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolio"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_project" ADD CONSTRAINT "portfolio_project_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portfolio_owner_idx" ON "portfolio" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "portfolio_project_project_idx" ON "portfolio_project" USING btree ("project_id");