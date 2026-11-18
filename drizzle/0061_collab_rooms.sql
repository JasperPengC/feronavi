CREATE TABLE "collab_room" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" uuid NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "project"("id") ON DELETE CASCADE,
  "mode" text NOT NULL,
  "base_revision_id" uuid REFERENCES "page_revision"("id") ON DELETE SET NULL,
  "snapshot_sequence" bigint DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "collab_room_type_allowed" CHECK ("collab_room"."resource_type" IN ('PAGE','WORK_ITEM','COMMENT','PLAN','APPROVAL','AUTOMATION')),
  CONSTRAINT "collab_room_mode_allowed" CHECK ("collab_room"."mode" IN ('TEXT_CRDT','COMMAND'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "collab_room_resource_key" ON "collab_room" USING btree ("resource_type","resource_id");
--> statement-breakpoint
CREATE INDEX "collab_room_project_idx" ON "collab_room" USING btree ("project_id");
--> statement-breakpoint
CREATE TABLE "collab_member" (
  "room_id" uuid NOT NULL REFERENCES "collab_room"("id") ON DELETE CASCADE,
  "member_id" uuid NOT NULL REFERENCES "member"("id") ON DELETE CASCADE,
  "client_id" text NOT NULL,
  "connected" boolean DEFAULT true NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("room_id","member_id","client_id")
);
--> statement-breakpoint
CREATE INDEX "collab_member_member_idx" ON "collab_member" USING btree ("member_id","last_seen_at");
--> statement-breakpoint
CREATE TABLE "collab_update" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "room_id" uuid NOT NULL REFERENCES "collab_room"("id") ON DELETE CASCADE,
  "sequence" bigint NOT NULL,
  "actor_id" uuid NOT NULL REFERENCES "member"("id") ON DELETE RESTRICT,
  "client_id" text NOT NULL,
  "operation_id" text NOT NULL,
  "update_base64" text NOT NULL,
  "state_vector_hash" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "collab_update_room_sequence_key" ON "collab_update" USING btree ("room_id","sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX "collab_update_operation_key" ON "collab_update" USING btree ("room_id","client_id","operation_id");
--> statement-breakpoint
CREATE INDEX "collab_update_room_created_idx" ON "collab_update" USING btree ("room_id","created_at");
--> statement-breakpoint
CREATE TABLE "collab_snapshot" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "room_id" uuid NOT NULL REFERENCES "collab_room"("id") ON DELETE CASCADE,
  "sequence" bigint NOT NULL,
  "state_base64" text NOT NULL,
  "base_revision_id" uuid REFERENCES "page_revision"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "collab_snapshot_room_sequence_idx" ON "collab_snapshot" USING btree ("room_id","sequence");
--> statement-breakpoint
CREATE INDEX "collab_snapshot_room_created_idx" ON "collab_snapshot" USING btree ("room_id","created_at");
