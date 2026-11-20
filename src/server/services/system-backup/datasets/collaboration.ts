import { defineDataset } from "../types.ts";

/** 未发表的 CRDT 正文属于持久业务内容；在线成员心跳由 registry 排除。 */
export const collaborationDatasets = [
  defineDataset({
    name: "content.collab_room", tableName: "collab_room", minimumMode: "safe",
    columns: ["id", "resource_type", "resource_id", "project_id", "mode", "base_revision_id", "snapshot_sequence", "created_at", "updated_at"],
    dateColumns: ["created_at", "updated_at"], orderBy: ["id"],
    dependsOn: ["projects.project", "content.page_revision"],
  }),
  defineDataset({
    name: "content.collab_update", tableName: "collab_update", minimumMode: "safe",
    columns: ["id", "room_id", "sequence", "actor_id", "client_id", "operation_id", "update_base64", "state_vector_hash", "created_at"],
    dateColumns: ["created_at"], orderBy: ["room_id", "sequence"],
    dependsOn: ["content.collab_room", "identity.member"],
  }),
  defineDataset({
    name: "content.collab_snapshot", tableName: "collab_snapshot", minimumMode: "safe",
    columns: ["id", "room_id", "sequence", "state_base64", "base_revision_id", "created_at"],
    dateColumns: ["created_at"], orderBy: ["room_id", "sequence"],
    dependsOn: ["content.collab_room", "content.page_revision"],
  }),
];
