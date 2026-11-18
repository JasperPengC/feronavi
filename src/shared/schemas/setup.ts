/** 安装向导的入参 schema（第 6.1 节六步；必答只有三项） */
import { z } from "zod";
import { usernameSchema } from "./auth.ts";

const timezoneSchema = z
  .string()
  .min(1)
  // ⚠️ 必须存 IANA 标识，**禁止存容器时区**（第 6.1 节）
  .regex(/^[A-Za-z]+\/[A-Za-z_+\-0-9]+$/, "时区必须是 IANA 标识，如 Asia/Shanghai");

export const setupCompleteSchema = z.object({
  admin: z.object({
    username: usernameSchema,
    email: z.string().email("邮箱格式不正确").max(320),
    password: z.string().min(12, "密码至少 12 个字符").max(1024),
    name: z.string().min(1, "请输入姓名").max(120),
  }),
  org: z.object({
    name: z.string().min(1, "请输入组织名称").max(200),
    defaultLocale: z.string().min(2).max(20).default("zh-CN"),
    defaultTimezone: timezoneSchema.default("Asia/Shanghai"),
    /** 组织形态：公司 / OPC（一人公司）；决定内置部门与岗位模板 */
    kind: z.enum(["COMPANY", "OPC"]).optional().default("COMPANY"),
    /** 首次安装时补充一套组织模板，可在向导第 4 步关闭 */
    seedDepartments: z.boolean().optional().default(true),
  }),
  integrations: z
    .object({
      smtp: z
        .object({
          host: z.string().max(255).nullable(),
          port: z.number().int().min(1).max(65535).nullable(),
          user: z.string().max(255).nullable(),
          password: z.string().max(512).nullable(),
          from: z.string().max(320).nullable(),
        })
        .nullable()
        .optional(),
      storage: z.object({
        kind: z.enum(["local", "s3"]),
        endpoint: z.string().max(2000).optional().nullable(),
        region: z.string().max(100).optional().nullable(),
        bucket: z.string().max(255).optional().nullable(),
        accessKey: z.string().max(512).optional().nullable(),
        secretKey: z.string().max(512).optional().nullable(),
        forcePathStyle: z.boolean().optional(),
        prefix: z.string().max(255).optional().nullable(),
      }).optional(),
      ai: z.unknown().nullable().optional(),
    })
    .optional(),
});
export type SetupCompleteInput = z.infer<typeof setupCompleteSchema>;
