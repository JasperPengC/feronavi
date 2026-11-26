import type { FastifyInstance } from "fastify";
import "../plugins-types.ts";
import { z } from "zod";
import { DomainError } from "../../shared/errors.ts";
import * as products from "../services/product.service.ts";
import type { Actor } from "../permission/actor.ts";

const params = z.object({ projectId: z.string().uuid(), productId: z.string().uuid().optional() });
export async function registerProductRoutes(app: FastifyInstance) {
  const actorOf = (req: { actor?: Actor }) => {
    if (!req.actor) throw new DomainError("FORBIDDEN", "未登录或会话已失效", null);
    return req.actor;
  };
  const base = "/api/v1/projects/:projectId/products";
  app.get(base, async req => {
    const { projectId } = params.parse(req.params);
    const query = z.object({ includeArchived: z.enum(["true", "false"]).optional() }).parse(req.query);
    return { products: await products.listProducts(actorOf(req), projectId, query.includeArchived === "true") };
  });
  app.get(base + "/:productId", async req => {
    const { projectId, productId } = params.parse(req.params);
    return products.getProduct(actorOf(req), projectId, productId!);
  });
  app.post(base, { onRequest: app.csrfProtection }, async (req, reply) => {
    const { projectId } = params.parse(req.params);
    const product = await products.createProduct(actorOf(req), projectId, req.body);
    reply.status(201); return product;
  });
  app.patch(base + "/:productId", { onRequest: app.csrfProtection }, async req => {
    const { projectId, productId } = params.parse(req.params);
    return products.updateProduct(actorOf(req), projectId, productId!, req.body);
  });
  app.post(base + "/:productId/link", { onRequest: app.csrfProtection }, async req => {
    const { projectId, productId } = params.parse(req.params);
    return products.linkProductProject(actorOf(req), projectId, productId!, req.body);
  });
  app.post(base + "/:productId/unlink", { onRequest: app.csrfProtection }, async req => {
    const { projectId, productId } = params.parse(req.params);
    return products.unlinkProductProject(actorOf(req), projectId, productId!, req.body);
  });
}
