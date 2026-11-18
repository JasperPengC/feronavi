import { apiPatch, apiPost } from "./api.ts";
import { draftImageTokens, withoutDraftImages } from "./useMarkdownImages.ts";

export interface CreatedWorkItemDraft { id: string; version: number }

/** 保留成功创建的目标；附件或正文补写失败后，重试始终落在同一工作项。 */
export async function saveNewWorkItem(
  session: { current: CreatedWorkItemDraft | null },
  projectId: string,
  body: Record<string, unknown> & { description: string | null },
  persist: (text: string, targetType: string, targetId: string) => Promise<string>,
): Promise<CreatedWorkItemDraft> {
  const resuming = !!session.current;
  const description = body.description ?? "";
  if (!session.current) {
    session.current = await apiPost<CreatedWorkItemDraft>(`/api/v1/projects/${projectId}/work-items`, {
      ...body, description: withoutDraftImages(description) || null,
    });
  }
  if (!resuming && !draftImageTokens(description).length) return session.current;
  const resolved = await persist(description, "WORK_ITEM", session.current.id);
  const fields = { ...body }; delete fields.type;
  session.current = await apiPatch<CreatedWorkItemDraft>(`/api/v1/work-items/${session.current.id}`, {
    ...fields, description: resolved.trim() || null, version: session.current.version,
  });
  return session.current;
}
