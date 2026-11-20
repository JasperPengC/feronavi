/** 工作项协作、关注、工时、内容引用和本人偏好；由总注册表统一守卫。 */
import { z } from "zod";
import type { ToolDef } from "../tools.ts";
import { businessTool as tool, id, date, ok } from "./business-tool.ts";
import * as collaboration from "../../../services/collab.service.ts";
import * as prefsTime from "../../../services/prefs-time.service.ts";
import * as links from "../../../services/work-item-link.service.ts";

const workItem = { workItemId: id };
const minutes = z.number().int().min(1).max(2147483647);
const timeFields = {
  minutes,
  loggedDate: date,
  note: z.string().max(2000).nullable().optional(),
};
const follow = tool(
  "workitem.follow",
  "关注工作项，按指定渠道接收通知；重复调用不会重复关注。",
  "write",
  {
    ...workItem,
    channels: z
      .array(z.enum(["IN_APP", "EMAIL"]))
      .max(2)
      .optional(),
  },
  (ctx, args) =>
    ok(
      collaboration.follow(
        ctx.actor,
        args.workItemId,
        args.channels ?? ["IN_APP"],
      ),
    ),
  { idempotent: true },
);
// JSON Schema 声明集合语义，guard 在业务处理前拒绝重复渠道。
(
  follow.inputSchema.properties as Record<string, Record<string, unknown>>
).channels!.uniqueItems = true;
const updateTime = tool(
  "timeLog.update",
  "修改本人或有权管理的工作项工时。",
  "write",
  {
    timeLogId: id,
    minutes: minutes.optional(),
    loggedDate: date.optional(),
    note: timeFields.note,
  },
  (ctx, { timeLogId, ...patch }) =>
    prefsTime.updateTimeLog(ctx.actor, timeLogId, patch),
);
updateTime.inputSchema.anyOf = ["minutes", "loggedDate", "note"].map(
  (field) => ({ required: [field] }),
);

export const COLLABORATION_TOOLS: ToolDef[] = [
  tool(
    "workitem.collaborators",
    "读取工作项协作者。",
    "read",
    workItem,
    async (ctx, args) => ({
      collaborators: await collaboration.listCollaborators(
        ctx.actor,
        args.workItemId,
      ),
    }),
  ),
  tool(
    "workitem.addCollaborator",
    "添加工作项协作者；不改变主负责人。",
    "write",
    { ...workItem, memberId: id },
    (ctx, args) =>
      collaboration.addCollaborator(ctx.actor, args.workItemId, args.memberId),
    { idempotent: true },
  ),
  tool(
    "workitem.removeCollaborator",
    "移除协作者，或本人退出协作。",
    "write",
    { ...workItem, memberId: id },
    (ctx, args) =>
      ok(
        collaboration.removeCollaborator(
          ctx.actor,
          args.workItemId,
          args.memberId,
        ),
      ),
    { destructive: true },
  ),
  tool(
    "workitem.watchers",
    "读取工作项关注成员及其通知渠道。",
    "read",
    workItem,
    async (ctx, args) => ({
      watchers: await collaboration.listWatchers(ctx.actor, args.workItemId),
    }),
  ),
  follow,
  tool(
    "workitem.unfollow",
    "本人取消关注工作项。",
    "write",
    workItem,
    (ctx, args) => ok(collaboration.unfollow(ctx.actor, args.workItemId)),
    { idempotent: true },
  ),
  tool(
    "timeLog.list",
    "读取工作项工时记录。",
    "read",
    workItem,
    async (ctx, args) => ({
      timeLogs: await prefsTime.listTimeLogs(ctx.actor, args.workItemId),
    }),
  ),
  tool(
    "timeLog.create",
    "为本人登记工作项工时，支持幂等键重试。",
    "write",
    { ...workItem, ...timeFields },
    (ctx, { workItemId, ...input }) =>
      prefsTime.addTimeLog(ctx.actor, workItemId, input),
  ),
  updateTime,
  tool(
    "timeLog.delete",
    "删除本人或有权管理的工作项工时。",
    "write",
    { timeLogId: id },
    (ctx, args) => ok(prefsTime.deleteTimeLog(ctx.actor, args.timeLogId)),
    { destructive: true },
  ),
  tool(
    "workitem.contentLinks",
    "读取工作项与文档、想法或计划实体的引用链接。",
    "read",
    workItem,
    async (ctx, args) => ({
      links: await links.listLinks(ctx.actor, args.workItemId),
    }),
  ),
  tool(
    "workitem.createContentLink",
    "引用同项目内的工作项、想法、文档、里程碑或迭代。",
    "write",
    { ...workItem, targetType: z.enum(links.LINK_TYPES), targetId: id },
    (ctx, { workItemId, ...input }) =>
      links.createLink(ctx.actor, workItemId, input),
  ),
  tool(
    "workitem.deleteContentLink",
    "移除工作项内容引用。",
    "write",
    { contentLinkId: id },
    (ctx, args) => ok(links.deleteLink(ctx.actor, args.contentLinkId)),
    { destructive: true },
  ),
  tool(
    "prefs.get",
    "读取本人界面、语言和时区偏好。",
    "read",
    {},
    (ctx) => prefsTime.getPreferences(ctx.actor),
    { scope: "identity" },
  ),
  tool(
    "prefs.update",
    "更新本人界面、语言和时区偏好。",
    "write",
    {
      theme: z.enum(["dark", "light", "system"]).optional(),
      locale: z.string().max(10).optional(),
      timezone: z.string().max(64).nullable().optional(),
      density: z.enum(["comfortable", "compact"]).optional(),
    },
    (ctx, patch) => prefsTime.putPreferences(ctx.actor, patch),
    { scope: "identity", idempotent: true },
  ),
];

// 所有写入口在读取幂等缓存前重验当前授权，复用 REST 与 MCP 共用的服务判定。
for (const definition of COLLABORATION_TOOLS) {
  if (definition.kind !== "write" || definition.name === "prefs.update")
    continue;
  definition.authorize = async (ctx, args) => {
    const workItemId = String(args.workItemId);
    switch (definition.name) {
      case "workitem.addCollaborator":
      case "workitem.removeCollaborator":
        await collaboration.authorizeCollaboratorWrite(
          ctx.actor,
          workItemId,
          String(args.memberId),
          definition.name === "workitem.addCollaborator" ? "add" : "remove",
        );
        break;
      case "workitem.follow":
      case "workitem.unfollow":
        await collaboration.assertWorkItemVisible(ctx.actor, workItemId);
        break;
      case "timeLog.create":
        await prefsTime.assertTimeLogWorkItemVisible(ctx.actor, workItemId);
        break;
      case "timeLog.update":
      case "timeLog.delete":
        await prefsTime.authorizeTimeLogMutation(
          ctx.actor,
          String(args.timeLogId),
        );
        break;
      case "workitem.createContentLink":
        await links.authorizeContentLinkCreate(ctx.actor, workItemId, {
          targetType: String(args.targetType),
          targetId: String(args.targetId),
        });
        break;
      case "workitem.deleteContentLink":
        await links.authorizeContentLinkDelete(
          ctx.actor,
          String(args.contentLinkId),
        );
        break;
    }
  };
}
