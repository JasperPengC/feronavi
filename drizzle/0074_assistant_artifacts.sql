CREATE TABLE "assistant_artifact" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" uuid NOT NULL REFERENCES "member"("id") ON DELETE CASCADE,
  "source_token_id" uuid REFERENCES "api_token"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "allowed_project_ids" jsonb NOT NULL,
  "filename" text,
  "mime_type" text,
  "size_bytes" integer,
  "sha256" text,
  "destination" jsonb,
  "payload_encrypted" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "assistant_artifact_kind_check" CHECK ("kind" in ('FILE','CREDENTIAL')),
  CONSTRAINT "assistant_artifact_scope_check" CHECK (jsonb_typeof("allowed_project_ids") = 'array' and jsonb_array_length("allowed_project_ids") between 1 and 20),
  CONSTRAINT "assistant_artifact_size_check" CHECK ("size_bytes" is null or ("size_bytes" > 0 and "size_bytes" <= 8388608))
);
--> statement-breakpoint
CREATE INDEX "assistant_artifact_owner_created_idx" ON "assistant_artifact" ("owner_id", "created_at");
--> statement-breakpoint
CREATE INDEX "assistant_artifact_expires_idx" ON "assistant_artifact" ("expires_at");
