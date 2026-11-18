/**
 * IM 自建应用消息协议（Round 88）
 *
 * 与应用消息 API 的真实请求形态一一对应；纯函数返回 {url, init}，便于单测与 mock 厂商验证。
 * API base 允许环境变量覆盖（仅用于本地 mock 测试，生产走官方域名）。
 */
import type { ImProvider } from "./im-protocol.ts";

export function imApiBase(provider: ImProvider): string {
  if (provider === "DINGTALK") return process.env.IM_DINGTALK_API_BASE ?? "https://oapi.dingtalk.com";
  if (provider === "WECOM") return process.env.IM_WECOM_API_BASE ?? "https://qyapi.weixin.qq.com";
  return process.env.IM_FEISHU_API_BASE ?? "https://open.feishu.cn";
}

const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});

export interface AppCredentials {
  appKey: string; appSecret: string; corpId?: string | null; agentId?: string | null;
}
export type RequestSpec = { url: string; init: { method: string; headers: Record<string, string>; body?: string } };

/** 钉钉：gettoken → 工作通知 asyncsend_v2 */
export function dingtalkTokenRequest(c: AppCredentials): RequestSpec {
  const base = imApiBase("DINGTALK");
  return { url: `${base}/gettoken?appkey=${encodeURIComponent(c.appKey)}&appsecret=${encodeURIComponent(c.appSecret)}`, init: { method: "GET", headers: {} } };
}
export function dingtalkSendRequest(c: AppCredentials, recipients: string[], text: string, token: string): RequestSpec {
  const base = imApiBase("DINGTALK");
  return {
    url: `${base}/topapi/message/corpconversation/asyncsend_v2?access_token=${encodeURIComponent(token)}`,
    init: post({ agent_id: Number(c.agentId), userid_list: recipients.join(","), msg: { msgtype: "text", text: { content: text } } }),
  };
}

/** 企业微信：gettoken → 应用消息 send */
export function wecomTokenRequest(c: AppCredentials): RequestSpec {
  const base = imApiBase("WECOM");
  return { url: `${base}/cgi-bin/gettoken?corpid=${encodeURIComponent(c.corpId ?? "")}&corpsecret=${encodeURIComponent(c.appSecret)}`, init: { method: "GET", headers: {} } };
}
export function wecomSendRequest(c: AppCredentials, recipients: string[], text: string, token: string): RequestSpec {
  const base = imApiBase("WECOM");
  return {
    url: `${base}/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`,
    init: post({ touser: recipients.join("|"), msgtype: "text", agentid: Number(c.agentId), text: { content: text } }),
  };
}

/** 飞书：tenant_access_token → 每条消息一个 receive_id（open_id） */
export function feishuTokenRequest(c: AppCredentials): RequestSpec {
  const base = imApiBase("FEISHU");
  return { url: `${base}/open-apis/auth/v3/tenant_access_token/internal`, init: post({ app_id: c.appKey, app_secret: c.appSecret }) };
}
export function feishuSendRequest(recipientOpenId: string, text: string, token: string): RequestSpec {
  const base = imApiBase("FEISHU");
  return {
    url: `${base}/open-apis/im/v1/messages?receive_id_type=open_id`,
    init: post({ receive_id: recipientOpenId, msg_type: "text", content: JSON.stringify({ text }) }, { authorization: `Bearer ${token}` }),
  };
}

/** 解析 token 响应；失败返回错误字符串（纯函数，便于单测） */
export function tokenFromResponse(provider: ImProvider, body: Record<string, unknown>): { token: string | null; error: string | null } {
  if (provider === "FEISHU") {
    const code = body.code;
    if (code !== undefined && Number(code) !== 0) return { token: null, error: `飞书 token 错误码 ${String(code)}: ${String(body.msg ?? "")}` };
    const token = typeof body.tenant_access_token === "string" ? body.tenant_access_token : null;
    return token ? { token, error: null } : { token: null, error: "飞书 token 响应缺少 tenant_access_token" };
  }
  const token = typeof body.access_token === "string" ? body.access_token : null;
  const errcode = body.errcode;
  if (errcode !== undefined && Number(errcode) !== 0) {
    return { token: null, error: `IM token 错误码 ${String(errcode)}: ${String(body.errmsg ?? body.msg ?? "")}` };
  }
  return token ? { token, error: null } : { token: null, error: "token 响应缺少 access_token" };
}

/** 解析发送响应；失败返回错误字符串 */
export function sendErrorFromResponse(provider: ImProvider, body: Record<string, unknown>): string | null {
  if (provider === "FEISHU") {
    const code = body.code;
    if (code !== undefined && Number(code) !== 0) return `飞书发送错误码 ${String(code)}: ${String(body.msg ?? "")}`;
    return null;
  }
  const errcode = body.errcode;
  if (errcode !== undefined && Number(errcode) !== 0) return `IM 发送错误码 ${String(errcode)}: ${String(body.errmsg ?? "")}`;
  return null;
}
