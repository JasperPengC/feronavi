DROP INDEX IF EXISTS "collab_update_operation_key";
--> statement-breakpoint
CREATE UNIQUE INDEX "collab_update_operation_key" ON "collab_update" USING btree ("room_id","actor_id","client_id","operation_id");
