/** IM 群机器人协议（Round 76）：纯函数，无 DB/环境依赖，供服务与单测共用 */
export const IM_PROVIDERS = ["DINGTALK", "WECOM", "FEISHU"] as const;
export type ImProvider = (typeof IM_PROVIDERS)[number];

export const IM_PROVIDER_LABEL: Record<ImProvider, string> = {
  DINGTALK: "钉钉", WECOM: "企业微信", FEISHU: "飞书",
};

/** 各 provider 的群机器人文本消息体 */
export function buildImPayload(provider: ImProvider, text: string): Record<string, unknown> {
  if (provider === "FEISHU") return { msg_type: "text", content: { text } };
  // 钉钉 / 企微 webhook 协议一致
  return { msgtype: "text", text: { content: text } };
}

/** 解析 IM 返回体，code/StatusCode/errcode 非 0 视为失败（返回 null 表示成功） */
export function imResponseError(body: Record<string, unknown>): string | null {
  const code = body.code ?? body.StatusCode ?? body.errcode;
  if (code === undefined) return null;
  if (Number(code) === 0) return null;
  return `IM 返回错误码 ${String(code)}: ${String(body.msg ?? body.errmsg ?? "").slice(0, 160)}`;
}
