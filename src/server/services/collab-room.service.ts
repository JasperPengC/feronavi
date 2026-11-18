/** Pure resource-room identifiers, limits and capability contracts. */
import { DomainError } from "../../shared/errors.ts";
export const COLLAB_RESOURCE_TYPES = [
  "PAGE", "WORK_ITEM", "COMMENT", "PLAN", "APPROVAL", "AUTOMATION",
] as const;

export const COLLAB_MODES = ["TEXT_CRDT", "COMMAND"] as const;

export type CollabResourceType = (typeof COLLAB_RESOURCE_TYPES)[number];
export type CollabMode = (typeof COLLAB_MODES)[number];

const COMMAND_RESOURCE_TYPES = new Set<CollabResourceType>([
  "WORK_ITEM", "COMMENT", "PLAN", "APPROVAL", "AUTOMATION",
]);

export function isCollabResourceType(value: string): value is CollabResourceType {
  return (COLLAB_RESOURCE_TYPES as readonly string[]).includes(value);
}

export function modeForResource(resourceType: CollabResourceType): CollabMode {
  if (!isCollabResourceType(resourceType)) {
    throw new Error(`不支持的协作资源类型：${String(resourceType)}`);
  }
  return COMMAND_RESOURCE_TYPES.has(resourceType) ? "COMMAND" : "TEXT_CRDT";
}

export function roomKey(resourceType: CollabResourceType, resourceId: string): string {
  if (!isCollabResourceType(resourceType)) {
    throw new Error(`不支持的协作资源类型：${String(resourceType)}`);
  }
  if (!isUuid(resourceId)) throw new Error("协作资源 ID 必须是 UUID");
  return `${resourceType}/${resourceId.toLowerCase()}`;
}

export function validateClientId(value: string): string {
  const clientId = value.trim();
  if (clientId.length < 1 || clientId.length > 100) {
    throw new Error("协作客户端标识长度必须为 1 到 100 个字符");
  }
  return clientId;
}

const MAX_UPDATE_BYTES = 1_000_000;
export const MAX_ROOM_UPDATE_COUNT = 10_000;
export const MAX_ROOM_UPDATE_BYTES = 50_000_000;
export const SNAPSHOT_UPDATE_INTERVAL = 100;
export const SNAPSHOT_BYTES_INTERVAL = 5_000_000;

export function operationKey(actorId: string, clientId: string, operationId: string): string {
  return `${actorId}:${clientId}:${operationId}`;
}

export function assertRoomLogCapacity(currentCount: number, currentBytes: number, nextBytes: number): void {
  if (currentCount + 1 > MAX_ROOM_UPDATE_COUNT) throw new Error("协作日志超过最大条数限制");
  if (currentBytes + nextBytes > MAX_ROOM_UPDATE_BYTES) throw new Error("协作日志超过最大大小限制");
}

export function shouldAutoSnapshot(sequence: number, currentBytes: number): boolean {
  return sequence > 0 && (sequence % SNAPSHOT_UPDATE_INTERVAL === 0 || currentBytes >= SNAPSHOT_BYTES_INTERVAL);
}

export function assertDocumentUpdateAllowed(mode: CollabMode, canWrite: boolean): void {
  if (mode !== "TEXT_CRDT") throw new Error("该协作房间不支持正文 CRDT 更新");
  if (!canWrite) throw new Error("没有协作房间写权限");
}

export function validateDocumentUpdate(input: { operationId: string; updateBase64: string }): {
  operationId: string;
  update: Uint8Array;
} {
  const operationId = input.operationId.trim();
  if (!operationId || operationId.length > 120) throw new Error("操作标识不能为空且不能超过 120 个字符");
  if (!input.updateBase64) throw new Error("update 编码不能为空");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.updateBase64) || input.updateBase64.length % 4 !== 0) {
    throw new Error("update 必须使用合法的 base64 编码");
  }
  const update = Uint8Array.from(Buffer.from(input.updateBase64, "base64"));
  if (update.byteLength === 0) throw new Error("update 不能为空");
  if (update.byteLength > MAX_UPDATE_BYTES) throw new Error("update 超过 1MB 限制");
  return { operationId, update };
}

export { MAX_UPDATE_BYTES };

export function requireUserConfirmation(confirmed: boolean): void {
  if (!confirmed) throw new DomainError("COMMAND_CONFIRMATION_REQUIRED", "发布协作草稿前需要用户明确确认", null);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
