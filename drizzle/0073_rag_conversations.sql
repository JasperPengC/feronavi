CREATE TABLE IF NOT EXISTS "rag_conversation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" uuid NOT NULL REFERENCES "member"("id") ON DELETE CASCADE,
  "title" text DEFAULT '新对话' NOT NULL,
  "title_is_default" boolean DEFAULT true NOT NULL,
  "project_id" uuid REFERENCES "project"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "deleted_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_conversation_owner_updated_idx" ON "rag_conversation" ("owner_id", "updated_at", "id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rag_message" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "rag_conversation"("id") ON DELETE CASCADE,
  "request_id" uuid NOT NULL,
  "question" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "reply" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "rag_message_status_check" CHECK ("status" IN ('pending','completed','failed','cancelled','unavailable'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rag_message_request_key" ON "rag_message" ("conversation_id", "request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rag_message_pending_key" ON "rag_message" ("conversation_id") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_message_conversation_created_idx" ON "rag_message" ("conversation_id", "created_at", "id");
