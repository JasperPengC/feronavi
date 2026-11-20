/**
 * 邮件发信（第七期 D，规范 489 行「邮件通知 P2」）
 *
 * 三条纪律：
 *   1 **未配置 SMTP 不是错误** —— 返回 { ok:false, reason }，让调用方决定降级方式
 *      （向导允许跳过 SMTP，规范第 6.1 节明确要求支持这种降级）
 *   2 **发信失败不阻断主流程** —— 与 SSE 同纪律：通知先落库/先返回，投递失败只记日志
 *   3 正文是**预渲染中文文案**（与活动 summary 同纪律），模板集中在本文件
 */
import { safeOutboundFetch } from "../lib/safe-fetch.ts";
import { createTransport, type Transporter } from "nodemailer";
import { getSettingRaw } from "./setting.service.ts";

export type MailTransport = "SMTP" | "HTTP_API";
import type { HttpMailProvider } from "./mail-http.ts";
export interface MailConfig {
  transport: MailTransport;
  httpProvider: HttpMailProvider;
  httpEndpoint: string | null;
  httpDomain: string | null;
  host: string;
  port: number;
  user: string | null;
  password: string | null;
  from: string;
}

export interface SendResult {
  ok: boolean;
  reason?: string;
  messageId?: string;
}

/** 读配置（密码经 setting.service 解密后取得） */
export async function loadMailConfig(): Promise<MailConfig | null> {
  const [hostRaw, portRaw, user, password, from, transportRaw, providerRaw, endpointRaw, domainRaw] = await Promise.all([
    getSettingRaw("smtp.host"), getSettingRaw("smtp.port"), getSettingRaw("smtp.user"),
    getSettingRaw("smtp.password"), getSettingRaw("smtp.from"), getSettingRaw("mail.transport"),
    getSettingRaw("mail.httpProvider"), getSettingRaw("mail.httpEndpoint"), getSettingRaw("mail.httpDomain"),
  ]);
  const rawTransport = String(transportRaw ?? "SMTP");
  const transport: MailTransport = rawTransport === "SMTP" ? "SMTP" : "HTTP_API";
  const host = (hostRaw as string | null) ?? "";
  if (!host && transport === "SMTP") return null;
  if (!from) return null;
  const providerRawStr = String(providerRaw ?? "RESEND");
  const providers = ["RESEND", "SENDGRID", "MAILGUN", "POSTMARK", "BREVO", "CUSTOM"] as const;
  const httpProvider = (providers as readonly string[]).includes(providerRawStr) ? providerRawStr as HttpMailProvider : "RESEND";
  return {
    transport, httpProvider,
    httpEndpoint: (endpointRaw as string | null) ?? null,
    httpDomain: (domainRaw as string | null) ?? null,
    host,
    port: Number(portRaw ?? 587),
    user: (user as string | null) ?? null,
    password: (password as string | null) ?? null,
    from: String(from),
  };
}

/** HTTP API 发信：当前网络拦截 SMTP 时的备用通道；密钥复用 smtp.password。 */
async function sendHttpApi(cfg: MailConfig, msg: MailMessage): Promise<SendResult> {
  if (!cfg.password) return { ok: false, reason: "未配置 HTTP API Key" };
  try {
    const { buildHttpMailRequest } = await import("./mail-http.ts");
    const spec = buildHttpMailRequest({
      provider: cfg.httpProvider, endpoint: cfg.httpEndpoint, domain: cfg.httpDomain,
      apiKey: cfg.password, from: cfg.from,
    }, msg);
    const res = await safeOutboundFetch(spec.url, { ...spec.init, signal: AbortSignal.timeout(12_000) });
    const raw = await res.text();
    let body: { id?: string; message?: string; name?: string; error?: string; errors?: unknown } = {};
    try { body = JSON.parse(raw) as typeof body; } catch { /* 非 JSON 保留原文 */ }
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}: ${String(body.message ?? body.error ?? body.name ?? raw).slice(0, 300)}` };
    return { ok: true, messageId: body.id };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || "HTTP API 请求失败" };
  }
}

function buildTransport(cfg: MailConfig): Transporter {
  return createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    // 测试用的本地假 SMTP 不接受认证：给了用户名才启用 auth
    auth: cfg.user ? { user: cfg.user, pass: cfg.password ?? "" } : undefined,
    // 有认证时必须先建立 TLS；私有 CA 通过 NODE_EXTRA_CA_CERTS 配置信任。
    requireTLS: !!cfg.user && cfg.port !== 465,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** 发送。未配置 → ok:false（不抛错）；发送异常 → ok:false + reason（不抛错） */
export async function sendMail(msg: MailMessage): Promise<SendResult> {
  const cfg = await loadMailConfig();
  if (!cfg) return { ok: false, reason: "未配置邮件发送" };
  if (cfg.transport === "HTTP_API") return sendHttpApi(cfg, msg);
  try {
    const info = await buildTransport(cfg).sendMail({
      from: cfg.from, to: msg.to, subject: msg.subject, text: msg.text,
    });
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    const reason = (e as Error).message || "发送失败";
    console.error("[mail] 投递失败（不阻断主流程）:", reason);
    return { ok: false, reason };
  }
}

// ── 预渲染中文模板（集中一处，避免散落在各调用点）────────────

export const templates = {
  /** 密码找回：15 分钟单次有效（规范 5.11） */
  passwordReset(link: string, ttlMinutes = 15): MailMessage["text"] {
    return [
      "你正在重置 Feronavi 的登录密码。",
      "",
      `重置链接（${ttlMinutes} 分钟内有效，只能使用一次）：`,
      link,
      "",
      "如果这不是你本人的操作，请忽略本邮件，你的密码不会被修改。",
    ].join("\n");
  },

  /** 成员邀请：7 天单次有效（总纲 5.11） */
  invite(inviteUrl: string, ttlDays = 7): MailMessage["text"] {
    return [
      "你被邀请加入 Feronavi。",
      "",
      `邀请链接（${ttlDays} 天内有效，只能使用一次）：`,
      inviteUrl,
      "",
      "如果这不是你期待的邀请，请忽略本邮件。",
    ].join("\n");
  },

  /** 通知投递：把站内通知的标题与正文原样转述，附落地链接 */
  notification(title: string, body: string, link: string | null): MailMessage["text"] {
    return [
      title,
      "",
      body,
      ...(link ? ["", `打开：${link}`] : []),
      "",
      "—— 来自 Feronavi（可在个人设置里关闭邮件通知或设置免打扰时段）",
    ].join("\n");
  },

  /** SMTP 自检（向导第 5 步「带测试」） */
  smtpTest(): MailMessage["text"] {
    return [
      "这是一封 Feronavi 的 SMTP 测试邮件。",
      "",
      "收到它说明邮件配置可用；通知与密码找回将使用同一配置。",
    ].join("\n");
  },
};
