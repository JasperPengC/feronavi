export interface AttachmentCollabEventInput {
  attachmentId: string;
  targetType: string;
  targetId: string;
  projectId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ImportCollabEventInput {
  batchId: string;
  projectId: string;
  status: string;
  created?: number;
  skipped?: number;
  failed?: number;
  removed?: number;
}

export function attachmentCollabEvent(event: "attachment.uploaded" | "attachment.deleted", input: AttachmentCollabEventInput) {
  return {
    event,
    data: {
      attachmentId: input.attachmentId,
      targetType: input.targetType,
      targetId: input.targetId,
      projectId: input.projectId,
      originalName: input.originalName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    },
  } as const;
}

export function importCollabEvent(event: "import.completed" | "import.rolled_back", input: ImportCollabEventInput) {
  return {
    event,
    data: {
      batchId: input.batchId,
      projectId: input.projectId,
      status: input.status,
      ...(input.created === undefined ? {} : { created: input.created }),
      ...(input.skipped === undefined ? {} : { skipped: input.skipped }),
      ...(input.failed === undefined ? {} : { failed: input.failed }),
      ...(input.removed === undefined ? {} : { removed: input.removed }),
    },
  } as const;
}
