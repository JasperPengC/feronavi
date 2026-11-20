/** 文件内容与凭据只送受控入口，不成为对话文本或模型参数。 */
const uuid = { type: "string", format: "uuid" };
const projects = { type: "array", items: uuid, minItems: 1, maxItems: 20 };
const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: false });
const expiresAt = { type: "string", format: "date-time" };
const security = [{ bearerAuth: [] }, { sessionAuth: [], csrfHeader: [] }];
const response = (schema: unknown) => ({
  description: "仅返回受控引用及元信息；不返回原始内容和凭据。",
  content: { "application/json": { schema } },
});
export const ragArtifactSchemas = {
  FileArtifact: object({
    artifactId: uuid,
    filename: { type: "string" },
    mimeType: { type: "string" },
    sizeBytes: { type: "integer", maximum: 8388608 },
    allowedProjectIds: projects,
    expiresAt,
  }),
  CredentialArtifact: object({
    credentialRef: uuid,
    allowedProjectIds: projects,
    expiresAt,
  }),
};
export const ragArtifactPaths = {
  "/api/v1/rag/artifacts/files": {
    post: {
      operationId: "ragFileArtifact",
      summary: "上传不超过8MiB的临时文件，绑定明确的项目范围与当前身份",
      tags: ["RAG"],
      security,
      requestBody: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: object({
              file: { type: "string", format: "binary" },
              projectIds: {
                type: "string",
                description: "1到20个项目UUID的JSON数组；必须先于file字段",
              },
            }),
          },
        },
      },
      responses: {
        201: response({ $ref: "#/components/schemas/FileArtifact" }),
      },
    },
  },
  "/api/v1/rag/artifacts/credentials": {
    post: {
      operationId: "ragCredentialArtifact",
      summary: "通过专用表单提交临时凭据并绑定目标服务，禁止粘贴到对话",
      tags: ["RAG"],
      security,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: object({
              token: {
                type: "string",
                writeOnly: true,
                minLength: 1,
                maxLength: 2000,
              },
              projectIds: projects,
              kind: { enum: ["GITHUB", "GITLAB", "GITEE"] },
              baseUrl: { type: "string", format: "uri" },
            }),
          },
        },
      },
      responses: {
        201: response({ $ref: "#/components/schemas/CredentialArtifact" }),
      },
    },
  },
  "/api/v1/rag/artifacts/{artifactId}": {
    delete: {
      operationId: "ragArtifactDelete",
      summary: "移除本账号暂存资料，后续确认不可继续使用该引用",
      tags: ["RAG"],
      security,
      parameters: [
        { in: "path", name: "artifactId", required: true, schema: uuid },
      ],
      responses: { 200: response(object({ ok: { const: true } })) },
    },
  },
  "/api/v1/rag/attachments/{attachmentId}/download": {
    get: {
      operationId: "ragAttachmentDownload",
      summary: "下载当前有权读取的附件，实时重验Token范围及附件父对象权限",
      tags: ["RAG"],
      security: [{ bearerAuth: [] }, { sessionAuth: [] }],
      parameters: [
        { in: "path", name: "attachmentId", required: true, schema: uuid },
      ],
      responses: {
        200: {
          description: "附件以attachment下载，no-store且nosniff",
          content: {
            "application/octet-stream": {
              schema: { type: "string", format: "binary" },
            },
          },
        },
      },
    },
  },
};
