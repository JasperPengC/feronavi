/** RAG公共API：浏览器会话要求CSRF；Bearer复用API令牌认证及项目范围。 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import { ragChatSchema, ragSearchSchema } from "../../shared/rag.ts";
import {
  authenticateToken,
  type TokenContext,
} from "../services/token.service.ts";
import { registerRagConversationRoutes } from "./rag-conversations.ts";
import { registerRagArtifactRoutes } from "./rag-artifacts.ts";
import * as rag from "../services/rag.service.ts";
import { ragOpenApi } from "./rag-openapi.ts";
import type { Actor } from "../permission/actor.ts";
declare module "fastify" {
  interface FastifyRequest {
    ragIdentity?: {
      actor: Actor;
      projectIds?: string[];
      bearer: boolean;
      token?: TokenContext;
    };
  }
}
export async function registerRagRoutes(app: FastifyInstance): Promise<void> {
  app.decorateRequest("ragIdentity", undefined);
  const auth = async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization;
    if (header !== undefined) {
      const match = /^Bearer\s+(\S+)$/iu.exec(header);
      const identity = match
        ? await authenticateToken(match[1]!, req.ip ?? null)
        : null;
      if (!identity)
        return reply
          .code(401)
          .send({ code: "FORBIDDEN", message: "身份验证失败", details: null });
      req.ragIdentity = {
        actor: identity.actor,
        projectIds: identity.ctx.projectWhitelist.length
          ? identity.ctx.projectWhitelist
          : undefined,
        bearer: true,
        token: identity.ctx,
      };
    } else {
      if (!req.actor)
        return reply
          .code(401)
          .send({
            code: "FORBIDDEN",
            message: "请先登录或使用有效API令牌",
            details: null,
          });
      req.ragIdentity = { actor: req.actor, bearer: false };
    }
    reply.header("cache-control", "no-store");
  };
  const csrf = (req: FastifyRequest, reply: FastifyReply, done: () => void) => {
    if (req.ragIdentity?.bearer) return done();
    app.csrfProtection(req, reply, done);
  };
  registerRagConversationRoutes(app, auth, csrf);
  registerRagArtifactRoutes(app, auth, csrf);
  app.get("/api/v1/openapi.json", async () => ragOpenApi);
  app.get("/api/v1/rag/attachments/:attachmentId/download",{preHandler:auth},async(req,reply)=>{
    const {attachmentId}=z.object({attachmentId:z.string().uuid()}).parse(req.params);
    const identity=req.ragIdentity!;
    const {projectForMcpResource}=await import("../services/mcp-resource.service.ts");
    const projectId=await projectForMcpResource("attachment",attachmentId);
    if(!projectId||identity.projectIds&&!identity.projectIds.includes(projectId))throw new DomainError("NOT_FOUND","附件不存在或不可访问",null);
    if(identity.token){const {assertToolPolicyAllowed}=await import("../services/mcp-client.service.ts");await assertToolPolicyAllowed(identity.token.tokenId,"attachment.download");}
    const {download}=await import("../services/attachment.service.ts");
    const file=await download(identity.actor,attachmentId);
    return reply.header("content-type",file.mimeType).header("content-disposition",`attachment; filename="${encodeURIComponent(file.originalName)}"`).header("x-content-type-options","nosniff").send(file.data);
  });
  app.get("/api/v1/rag/projects", { preHandler: auth }, async (req) => {
    const identity = req.ragIdentity!;
    return {
      items: await rag.listRagProjects(identity.actor, identity.projectIds, true),
    };
  });
  app.get(
    "/api/v1/rag/reports/:projectId.pdf",
    { preHandler: auth },
    async (req, reply) => {
      const { projectId } = z
        .object({ projectId: z.string().uuid() })
        .parse(req.params);
      const identity = req.ragIdentity!;
      if (identity.projectIds && !identity.projectIds.includes(projectId))
        throw new DomainError("NOT_FOUND", "报告不存在或不可访问", null);
      if (identity.token) {
        const { assertToolPolicyAllowed } = await import("../services/mcp-client.service.ts");
        await assertToolPolicyAllowed(identity.token.tokenId, "project.report");
      }
      const { projectReport } = await import("../services/report.service.ts");
      const { buffer, filename } = await projectReport(
        identity.actor,
        projectId,
      );
      return reply
        .header("content-type", "application/pdf")
        .header("content-disposition", `attachment; filename="${filename}"`)
        .send(buffer);
    },
  );
  app.post(
    "/api/v1/rag/search",
    { preHandler: [auth, csrf], bodyLimit: 40_000 },
    async (req) => {
      const input = ragSearchSchema.safeParse(req.body);
      if (!input.success)
        throw new DomainError(
          "VALIDATION",
          "检索参数不合法",
          input.error.issues,
        );
      const identity = req.ragIdentity!;
      return rag.searchRag(identity.actor, input.data, identity.projectIds);
    },
  );
  app.post(
    "/api/v1/rag/chat",
    {
      preHandler: [auth, csrf],
      bodyLimit: 100_000,
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (req) => {
      const input = ragChatSchema.safeParse(req.body);
      if (!input.success)
        throw new DomainError(
          "VALIDATION",
          "对话参数不合法",
          input.error.issues,
        );
      const identity = req.ragIdentity!;
      return rag.chatRag(
        identity.actor,
        input.data,
        identity.projectIds,
        undefined,
        { token: identity.token },
      );
    },
  );
}
