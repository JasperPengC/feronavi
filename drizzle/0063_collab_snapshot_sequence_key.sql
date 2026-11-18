DELETE FROM "collab_snapshot" older
USING "collab_snapshot" newer
WHERE older."room_id" = newer."room_id"
  AND older."sequence" = newer."sequence"
  AND older."id" > newer."id";
--> statement-breakpoint
CREATE UNIQUE INDEX "collab_snapshot_room_sequence_key" ON "collab_snapshot" USING btree ("room_id","sequence");
