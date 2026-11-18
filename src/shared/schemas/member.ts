import { z } from "zod";
import { usernameSchema } from "./auth.ts";

/** 管理员直建账号，REST 与表单共用；角色由服务端固定为普通成员。 */
export const createMemberSchema = z.object({
  name: z.string().trim().min(1).max(100),
  username: z.string().trim().toLowerCase().pipe(usernameSchema),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(12).max(200),
}).strict();

export type CreateMemberInput = z.infer<typeof createMemberSchema>;
