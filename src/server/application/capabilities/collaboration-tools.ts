/** 附属协作与生命周期入口；实际授权和持久化由领域服务完成。 */
import { z } from "zod";
import type { ToolCtx, ToolDef } from "./tools.ts";
import { DomainError } from "../../../shared/errors.ts";
import { requireUserConfirmation } from "../../services/collab-room.service.ts";
import { projectForMcpResource } from "../../services/mcp-resource.service.ts";
import * as items from "../../services/work-item.service.ts";
import * as progress from "../../services/issues.service.ts";
import * as transfers from "../../services/work-item-transfer.service.ts";
import * as collaborators from "../../services/collab.service.ts";
import * as comments from "../../services/comment.service.ts";
import * as projects from "../../services/project.service.ts";

const uuid = z.string().uuid();
const scope = { projectId: uuid, workItemId: uuid };
const confirmed = { userConfirmed: z.boolean().describe("用户已确认本次业务修改") };
const writeScope = { ...scope, ...confirmed };
const record = z.record(z.string(), z.unknown());
const entity = z.object({ id: uuid }).passthrough();
const ok = z.object({ ok: z.literal(true) });
const schema = (value: z.ZodType) => z.toJSONSchema(value, { target: "draft-7" }) as NonNullable<ToolDef["outputSchema"]>;
const tool = (name: string, kind: ToolDef["kind"], description: string, input: z.ZodType, output: z.ZodType, handler: ToolDef["handler"]): ToolDef => ({ name, kind, description, inputSchema: schema(input), outputSchema: schema(output), handler: kind === "write" ? async (ctx, args) => { requireUserConfirmation(args.userConfirmed === true); return handler(ctx, args); } : handler });
const missing = () => new DomainError("NOT_FOUND", "资源不存在", null);
async function itemFor(ctx: ToolCtx, args: Record<string, unknown>) {
  const row = await items.getWorkItem(ctx.actor, String(args.workItemId));
  if (row.projectId !== args.projectId) throw missing();
  return row;
}
const target = { projectId: uuid, targetType: z.enum(["WORK_ITEM", "PAGE", "MILESTONE"]), targetId: uuid };
async function commentTarget(args: Record<string, unknown>) {
  const kind = { WORK_ITEM: "workItem", PAGE: "page", MILESTONE: "milestone" }[String(args.targetType)] as "workItem" | "page" | "milestone";
  if (await projectForMcpResource(kind, String(args.targetId)) !== args.projectId) throw missing();
}
export const COLLABORATION_TOOLS: ToolDef[] = [
  tool("workitem.delete", "write", "用户确认后软删除工作项；有未删除子项时拒绝，保留编号和审计。", z.object(writeScope).strict(), ok, async (ctx, args) => { await itemFor(ctx, args); await items.deleteWorkItem(ctx.actor, String(args.workItemId)); return { ok: true }; }),
  tool("workitem.listProgress", "read", "读取工作项结构化进展、下一步和阻碍。", z.object(scope).strict(), z.object({ updates: z.array(entity) }), async (ctx, args) => { await itemFor(ctx, args); return { updates: await progress.listProgressUpdates(ctx.actor, String(args.workItemId)) }; }),
  tool("workitem.addProgress", "write", "确认后记录处理进展；需要工作项编辑能力。", z.object({ ...writeScope, summary: z.string().trim().min(1).max(2000), nextSteps: z.string().max(5000).nullable().optional(), blockers: z.string().max(5000).nullable().optional() }).strict(), entity, async (ctx, args) => { await itemFor(ctx, args); return progress.addProgressUpdate(ctx.actor, String(args.workItemId), { summary: String(args.summary), nextSteps: args.nextSteps as string | null | undefined, blockers: args.blockers as string | null | undefined }); }),
  tool("workitem.deleteProgress", "write", "删除指定工作项的进展记录；记录必须归属该工作项。", z.object({ ...writeScope, progressUpdateId: uuid }).strict(), ok, async (ctx, args) => { await itemFor(ctx, args); if (!(await progress.listProgressUpdates(ctx.actor, String(args.workItemId))).some(row => row.id === args.progressUpdateId)) throw missing(); await progress.deleteProgressUpdate(ctx.actor, String(args.progressUpdateId)); return { ok: true }; }),
  tool("workitem.listTransfers", "read", "读取负责人转派历史及原因。", z.object(scope).strict(), z.object({ transfers: z.array(entity) }), async (ctx, args) => { await itemFor(ctx, args); return { transfers: await transfers.listTransfers(ctx.actor, String(args.workItemId)) }; }),
  tool("workitem.transfer", "write", "确认后将工作项转派给指定成员（null为取消指派），记录原因，version使用当前版本。", z.object({ ...writeScope, assigneeId: uuid.nullable(), reason: z.string().max(2000).nullable().optional(), version: z.number().int().positive() }).strict(), entity, async (ctx, args) => { await itemFor(ctx, args); return transfers.transferWorkItem(ctx.actor, String(args.workItemId), { assigneeId: args.assigneeId as string | null, reason: args.reason as string | null | undefined, version: Number(args.version) }); }),
  tool("workitem.listCollaborators", "read", "读取工作项协作者；协作者身份不同于负责人和关注者。", z.object(scope).strict(), z.object({ collaborators: z.array(record) }), async (ctx, args) => { await itemFor(ctx, args); return { collaborators: await collaborators.listCollaborators(ctx.actor, String(args.workItemId)) }; }),
  tool("workitem.addCollaborator", "write", "确认后添加工作项协作者，仍受项目权限约束。", z.object({ ...writeScope, memberId: uuid }).strict(), record, async (ctx, args) => { await itemFor(ctx, args); return collaborators.addCollaborator(ctx.actor, String(args.workItemId), String(args.memberId)); }),
  tool("workitem.removeCollaborator", "write", "确认后移除协作者，允许本人退出。", z.object({ ...writeScope, memberId: uuid }).strict(), ok, async (ctx, args) => { await itemFor(ctx, args); await collaborators.removeCollaborator(ctx.actor, String(args.workItemId), String(args.memberId)); return { ok: true }; }),
  tool("workitem.listWatchers", "read", "读取工作项关注者及通知渠道。", z.object(scope).strict(), z.object({ watchers: z.array(record) }), async (ctx, args) => { await itemFor(ctx, args); return { watchers: await collaborators.listWatchers(ctx.actor, String(args.workItemId)) }; }),
  tool("workitem.follow", "write", "确认后由当前账号关注工作项；默认仅站内通知，重复关注幂等。", z.object({ ...writeScope, channels: z.array(z.enum(["IN_APP", "EMAIL"])).max(2).optional() }).strict(), ok, async (ctx, args) => { await itemFor(ctx, args); await collaborators.follow(ctx.actor, String(args.workItemId), (args.channels as string[] | undefined) ?? ["IN_APP"]); return { ok: true }; }),
  tool("workitem.unfollow", "write", "确认后取消当前账号关注，重复取消幂等。", z.object(writeScope).strict(), ok, async (ctx, args) => { await itemFor(ctx, args); await collaborators.unfollow(ctx.actor, String(args.workItemId)); return { ok: true }; }),
  tool("comment.list", "read", "读取工作项、文档或里程碑评论；传parentId读取回复，省略时读取顶层。", z.object({ ...target, parentId: uuid.nullable().optional() }).strict(), z.object({ comments: z.array(entity) }), async (ctx, args) => { await commentTarget(args); return { comments: await comments.listComments(ctx.actor, String(args.targetType), String(args.targetId), { parentId: args.parentId as string | null | undefined }) }; }),
  tool("comment.create", "write", "用户确认后在工作项、文档或里程碑创建评论/回复；受父资源可见性和文档ACL限制。", z.object({ ...target, ...confirmed, body: z.string().trim().min(1).max(20000), parentId: uuid.nullable().optional() }).strict(), entity, async (ctx, args) => { await commentTarget(args); return comments.createComment(ctx.actor, { targetType: String(args.targetType), targetId: String(args.targetId), body: String(args.body), parentId: args.parentId as string | null | undefined }); }),
  ...(["archive", "unarchive"] as const).map(action => tool(`project.${action}`, "write", `${action === "archive" ? "归档" : "恢复归档"}项目；需要project:archive权限及用户确认，保留业务历史。`, z.object({ projectId: uuid, ...confirmed }).strict(), ok, async (ctx, args) => { await projects.setArchived(ctx.actor, String(args.projectId), action === "archive"); return { ok: true }; })),
];

// 关注渠道是集合，重复值在业务调用前拒绝。
(COLLABORATION_TOOLS.find(tool => tool.name === "workitem.follow")!.inputSchema.properties as Record<string, Record<string, unknown>>).channels!.uniqueItems = true;
