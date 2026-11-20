/** 文件/凭据从浏览器直送；仅返回资料引用，绝不通过聊天工具接收秘密。 */
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
const ASSISTANT_ARTIFACT_MAX_BYTES = 8 * 1024 * 1024;
const projectIds = z.array(z.string().uuid()).min(1).max(20);
const credentialInput = z.object({ token: z.string().min(1).max(2000), projectIds, kind: z.enum(["GITHUB", "GITLAB", "GITEE"]), baseUrl: z.string().url().max(500) }).strict();
export function registerRagArtifactRoutes(app: FastifyInstance, auth: preHandlerHookHandler, csrf: preHandlerHookHandler) {
  const write = { preHandler: [auth, csrf], config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };
  app.post("/api/v1/rag/artifacts/files", { ...write, bodyLimit: ASSISTANT_ARTIFACT_MAX_BYTES + 16_384 }, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: ASSISTANT_ARTIFACT_MAX_BYTES, files: 1, fields: 1 } });
    if (!file || file.fieldname !== "file") throw new DomainError("VALIDATION", "请选择一个文件", null);
    const data = await file.toBuffer();
    const field = file.fields.projectIds;
    let parsed: z.ZodSafeParseResult<string[]>;
    try { parsed = projectIds.safeParse(JSON.parse(field && !Array.isArray(field) && "value" in field ? String(field.value) : "null")); }
    catch { throw new DomainError("VALIDATION", "请明确选择上传目标项目", null); }
    if (!parsed.success) throw new DomainError("VALIDATION", "请明确选择1至20个项目", null);
    const { actor, token, projectIds: allowedProjectIds } = req.ragIdentity!;
    const { createAssistantFile } = await import("../services/assistant-artifact.service.ts");
    const result = await createAssistantFile(actor, { filename: file.filename, mimeType: file.mimetype, data, projectIds: parsed.data }, token, allowedProjectIds);
    return reply.code(201).send(result);
  });
  app.post("/api/v1/rag/artifacts/credentials", { ...write, bodyLimit: 16_384 }, async (req, reply) => {
    const parsed = credentialInput.safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION", "凭据表单参数不合法", null);
    const { actor, token, projectIds: allowedProjectIds } = req.ragIdentity!;
    const { createAssistantCredential } = await import("../services/assistant-artifact.service.ts");
    return reply.code(201).send(await createAssistantCredential(actor, parsed.data, token, allowedProjectIds));
  });
  app.delete("/api/v1/rag/artifacts/:artifactId", write, async req => {
    const { artifactId } = z.object({ artifactId: z.string().uuid() }).parse(req.params);
    const { removeAssistantArtifact } = await import("../services/assistant-artifact.service.ts");
    return removeAssistantArtifact(req.ragIdentity!.actor, artifactId, req.ragIdentity!.token);
  });
}
