import { DomainError } from "../../shared/errors.ts";
import type { AssistantAccess } from "./assistant-tool-authorization.ts";
import type { ToolDef } from "../application/capabilities/tools.ts";
/** 模型/历史始终只保存opaque引用，解密只发生在当前授权执行边界。 */
export async function hydrateAssistantParameters(
  access: AssistantAccess,
  tool: ToolDef,
  args: Record<string, unknown>,
  projectId: string | null,
) {
  const parameters = { ...args };
  if (projectId && Object.hasOwn(tool.inputSchema.properties ?? {}, "projectId")) parameters.projectId = projectId;
  if (tool.name === "attachment.download") {
    const { getMetadata } = await import("./attachment.service.ts");
    const attachment = await getMetadata(access.actor, String(args.attachmentId));
    if ((args.targetId !== undefined && args.targetId !== attachment.targetId) || (args.targetType !== undefined && args.targetType !== attachment.targetType)) throw new DomainError("NOT_FOUND", "附件不属于指定业务对象", null);
    if (args.workItemId !== undefined && (attachment.targetType !== "WORK_ITEM" || args.workItemId !== attachment.targetId)) throw new DomainError("NOT_FOUND", "附件不属于指定工作项", null);
    delete parameters.workItemId;
    parameters.targetType = attachment.targetType;
    parameters.targetId = attachment.targetId;
  }
  if (["attachment.upload", "import.create"].includes(tool.name)) {
    if (
      typeof args.artifactId !== "string" ||
      !projectId ||
      ("contentBase64" in args || "dataBase64" in args)
    )
      throw new DomainError("VALIDATION", "请先通过文件入口上传文件", null);
    if (!access.artifactIds?.includes(args.artifactId))
      throw new DomainError("FORBIDDEN", "文件未附加到本次请求", null);
    const { resolveAssistantFile } =
      await import("./assistant-artifact.service.ts");
    const file = await resolveAssistantFile(
      access.actor,
      args.artifactId,
      projectId,
      access.token,
    );
    const filenameKey =
      tool.name === "attachment.upload" ? "originalName" : "filename";
    if (args[filenameKey] !== file.filename)
      throw new DomainError("VALIDATION", "文件名与上传文件不一致", null);
    delete parameters.artifactId;
    if (tool.name === "attachment.upload") {
      if (Buffer.byteLength(file.contentBase64, "base64") > 512 * 1024) throw new DomainError("VALIDATION", "附件不得超过512KiB", null);
      parameters.dataBase64 = file.contentBase64;
      parameters.mimeType = file.mimeType;
    } else parameters.contentBase64 = file.contentBase64;
  }
  if (["integration.create", "integration.update"].includes(tool.name)) {
    if ("token" in args)
      throw new DomainError("VALIDATION", "凭据必须通过专用表单提交", null);
    if (typeof args.credentialRef === "string") {
      if (!access.credentialRefs?.includes(args.credentialRef))
        throw new DomainError("FORBIDDEN", "凭据未附加到本次请求", null);
      if (!projectId)
        throw new DomainError("VALIDATION", "集成必须关联项目", null);
      let destination = {
        kind: String(args.kind ?? ""),
        baseUrl: String(args.baseUrl ?? ""),
      };
      if (tool.name === "integration.update") {
        const { listIntegrations } = await import("./integration.service.ts");
        const current = (await listIntegrations(access.actor, projectId)).find(
          (r) => r.id === args.integrationId,
        );
        if (!current) throw new DomainError("NOT_FOUND", "集成不可访问", null);
        destination = {
          kind: current.kind,
          baseUrl:
            typeof args.baseUrl === "string" ? args.baseUrl : current.baseUrl,
        };
      }
      const { resolveAssistantCredential } =
        await import("./assistant-artifact.service.ts");
      if (!["GITHUB", "GITLAB", "GITEE"].includes(destination.kind))
        throw new DomainError("VALIDATION", "不支持的集成服务", null);
      parameters.token = await resolveAssistantCredential(
        access.actor,
        args.credentialRef,
        projectId,
        access.token,
        {
          ...destination,
          kind: destination.kind as "GITHUB" | "GITLAB" | "GITEE",
        },
      );
      delete parameters.credentialRef;
    }
  }
  return parameters;
}
