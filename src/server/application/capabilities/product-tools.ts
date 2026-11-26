import { z } from "zod";
import type { ToolDef } from "./tools.ts";
import { createProductSchema, linkProductSchema, productVersionSchema, updateProductSchema } from "../../../shared/schemas/product.ts";
import * as products from "../../services/product.service.ts";
import { withIdempotency } from "../../services/idempotency.service.ts";
import { forbidden } from "../../../shared/errors.ts";

const uuid = z.string().uuid();
const ref = { projectId: uuid, productId: uuid };
const confirmed = { userConfirmed: z.literal(true) };
const result = z.object({ id: uuid, name: z.string(), description: z.string().nullable(), version: z.number().int(),
  archivedAt: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(), canManage: z.boolean(), canUnlink: z.boolean(), requirementCount: z.number().int() });
const json = (schema: z.ZodType) => z.toJSONSchema(schema, { target: "draft-7" }) as NonNullable<ToolDef["outputSchema"]>;
const tool = (name: string, kind: ToolDef["kind"], description: string, input: z.ZodType, output: z.ZodType, handler: ToolDef["handler"]): ToolDef =>
  ({ name, kind, description, inputSchema: json(input), outputSchema: json(output), handler });

export const PRODUCT_TOOLS: ToolDef[] = [
  tool("product.list", "read", "读取当前项目已关联产品。includeArchived可包含归档产品；只返回本项目需求数，不泄露其它项目。canManage会同时检查账号与令牌所有关联项目范围。", z.object({ projectId: uuid, includeArchived: z.boolean().optional() }).strict(), z.object({ products: z.array(result) }),
    async (ctx, a) => ({ products: await products.listProducts(ctx.actor, String(a.projectId), a.includeArchived === true, ctx.token.projectWhitelist) })),
  tool("product.get", "read", "读取已关联当前项目的产品、version与管理能力；需求归属使用workitem.create/update的productId。", z.object(ref).strict(), result,
    (ctx, a) => products.getProduct(ctx.actor, String(a.projectId), String(a.productId), ctx.token.projectWhitelist)),
  tool("product.create", "write", "创建产品并关联当前项目，需project:update。可传idempotencyKey避免重复创建；重放仍检查当前权限。", createProductSchema.extend({ projectId: uuid, idempotencyKey: z.string().min(1).max(200).optional(), ...confirmed }), result,
    async (ctx, a) => {
      const { projectId, idempotencyKey, userConfirmed: _confirmed, ...input } = a;
      await products.assertProductCreatable(ctx.actor, String(projectId), ctx.token.projectWhitelist);
      const saved = await withIdempotency({ actorId: ctx.actor.memberId, key: idempotencyKey as string | undefined, scope: "product.create", body: a },
        () => products.createProduct(ctx.actor, String(projectId), input, ctx.token.projectWhitelist));
      const current = await products.getProduct(ctx.actor, String(projectId), saved.value.id, ctx.token.projectWhitelist);
      if (!current.canManage) throw forbidden();
      return current;
    }),
  tool("product.update", "write", "编辑、归档或恢复产品，须提供当前expectedVersion并管理所有关联项目；令牌也须覆盖全部关联项目。归档保留现有需求归属，拒绝新归属。", updateProductSchema.safeExtend({ ...ref, ...confirmed }), result,
    (ctx, a) => { const { projectId, productId, userConfirmed: _confirmed, ...input } = a; return products.updateProduct(ctx.actor, String(projectId), String(productId), input, ctx.token.projectWhitelist); }),
  tool("product.linkProject", "write", "将当前项目的产品关联到targetProjectId。两端及所有已有关联项目均须管理权限和令牌范围；expectedVersion防止并发覆盖。不会授予项目访问权。", linkProductSchema.extend({ ...ref, ...confirmed }), result,
    (ctx, a) => { const { projectId, productId, userConfirmed: _confirmed, ...input } = a; return products.linkProductProject(ctx.actor, String(projectId), String(productId), input, ctx.token.projectWhitelist); }),
  tool("product.unlinkProject", "write", "解除产品与当前项目关联。必须没有需求引用且保留至少一个项目；需全部关联项目管理权限及当前expectedVersion。", productVersionSchema.extend({ ...ref, ...confirmed }), z.object({ ok: z.boolean(), version: z.number().int() }),
    (ctx, a) => { const { projectId, productId, userConfirmed: _confirmed, ...input } = a; return products.unlinkProductProject(ctx.actor, String(projectId), String(productId), input, ctx.token.projectWhitelist); }),
];
