/**
 * 认证相关的 Zod schema —— **前后端单一真相源**
 *
 * 前端表单校验与后端入参校验共用这一份。放在 shared/ 而不是各自写一份，
 * 否则两边规则漂移后会出现「前端说行、后端说不行」（或更糟：反过来）。
 */
import { z } from "zod";

/** 用户名规则（数据模型 1.3）：小写、3–32 字符，`deleted-` 前缀保留给匿名化 */
export const usernameSchema = z
  .string()
  .min(3, "用户名至少 3 个字符")
  .max(32, "用户名最多 32 个字符")
  .regex(/^(?!deleted-)[a-z0-9][a-z0-9._-]*$/, "用户名只能包含小写字母、数字、点、下划线与连字符，且不能以 deleted- 开头");

/** 密码规则（第 5.9 节）：最小 12 字符，**不强制大小写/符号**（NIST SP 800-63B） */
export const passwordSchema = z
  .string()
  .min(12, "密码至少 12 个字符")
  .max(1024, "密码过长");

export const loginSchema = z.object({
  username: z.string().min(1, "请输入用户名").max(320),
  password: z.string().min(1, "请输入密码").max(1024),
  remember: z.boolean().optional(),
  totpCode: z.string().optional(),
  recoveryCode: z.string().optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "请输入当前密码").max(1024),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
