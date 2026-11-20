/** 业务工具仅负责契约和参数映射，权限与事务由已有领域服务承担。 */
import { z } from "zod";
import type { ToolCtx, ToolDef } from "../tools.ts";
import { withIdempotency } from "../../../services/idempotency.service.ts";
import { authorizeMcpOperation } from "../../../services/mcp-operation-authorization.service.ts";

export const id = z.string().uuid();
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const text = z.string().min(1).max(200);
export const ok = async (operation: Promise<unknown>) => {
  await operation;
  return { ok: true };
};

export function businessTool<S extends z.ZodRawShape>(
  name: string,
  description: string,
  kind: "read" | "write",
  shape: S,
  handler: (ctx: ToolCtx, args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
  metadata: Pick<
    ToolDef,
    "scope" | "destructive" | "idempotent" | "outputSchema" | "authorize"
  > = {},
): ToolDef {
  const schema = z.object(shape).strict();
  const input =
    kind === "write"
      ? schema.extend({ idempotencyKey: z.string().min(1).max(200).optional() })
      : schema;
  const definition: ToolDef = {
    name,
    description,
    kind,
    ...metadata,
    inputSchema: z.toJSONSchema(input, { target: "draft-7" }),
    handler: async (ctx, args) => {
      const { idempotencyKey, ...payload } = args;
      if (kind === "write")
        await authorizeMcpOperation(ctx.actor, name, payload);
      const parsed = schema.parse(payload);
      await definition.authorize?.(ctx, parsed);
      const invoke = async () => {
        const value = await handler(ctx, parsed);
        return value === undefined ? { ok: true } : value;
      };
      if (kind === "read" || !idempotencyKey) return invoke();
      const replay = await withIdempotency(
        {
          actorId: ctx.actor.memberId,
          key: String(idempotencyKey),
          scope: name,
          body: payload,
        },
        invoke,
      );
      return replay.value;
    },
  };
  return definition;
}
