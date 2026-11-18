CREATE TABLE "idempotency_key" (
	"key" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"request_hash" text NOT NULL,
	"state" text DEFAULT 'IN_PROGRESS' NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_key_key_actor_id_scope_pk" PRIMARY KEY("key","actor_id","scope"),
	CONSTRAINT "idempotency_state_allowed" CHECK ("idempotency_key"."state" IN ('IN_PROGRESS','DONE'))
);
--> statement-breakpoint
ALTER TABLE "idempotency_key" ADD CONSTRAINT "idempotency_key_actor_id_member_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idempotency_expires_idx" ON "idempotency_key" USING btree ("expires_at");