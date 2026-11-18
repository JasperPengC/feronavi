/**
 * HTTP API 邮件适配器（SMTP 出站被封时的备用通道）。
 * 目前覆盖 Resend / SendGrid / Mailgun / Postmark / Brevo / 自定义（Resend 兼容）。
 * 端点、API Key、发件人均来自设置，不写死在页面里。
 */
export type HttpMailProvider = "RESEND" | "SENDGRID" | "MAILGUN" | "POSTMARK" | "BREVO" | "CUSTOM";

export interface HttpMailConfig {
  provider: HttpMailProvider;
  /** 自定义 endpoint；为空时用 provider 默认值。Mailgun 可用 {domain} 占位。 */
  endpoint: string | null;
  /** Mailgun 发信域名 */
  domain: string | null;
  apiKey: string;
  /** 完整 From，允许 `Name <email@example.com>` */
  from: string;
}
export interface HttpMailMessage { to: string; subject: string; text: string }
export interface HttpRequestSpec { url: string; init: RequestInit }

const DEFAULTS: Record<HttpMailProvider, string> = {
  RESEND: "https://api.resend.com/emails",
  SENDGRID: "https://api.sendgrid.com/v3/mail/send",
  MAILGUN: "https://api.mailgun.net/v3/{domain}/messages",
  POSTMARK: "https://api.postmarkapp.com/email",
  BREVO: "https://api.brevo.com/v3/smtp/email",
  CUSTOM: "",
};

function parseFrom(from: string): { email: string; name: string | null } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (m) return { name: (m[1] ?? "").trim() || null, email: (m[2] ?? "").trim() };
  return { name: null, email: from.trim() };
}

function json(body: unknown, headers: Record<string, string>): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) };
}

export function buildHttpMailRequest(cfg: HttpMailConfig, msg: HttpMailMessage): HttpRequestSpec {
  const sender = parseFrom(cfg.from);
  let url = (cfg.endpoint?.trim() || DEFAULTS[cfg.provider]).trim();
  if (!url) throw new Error("HTTP API 端点未配置");
  if (cfg.provider === "MAILGUN") {
    if (!cfg.domain?.trim()) throw new Error("Mailgun 需要填写发信域名");
    url = url.replace("{domain}", encodeURIComponent(cfg.domain.trim()));
  }
  const auth = { authorization: `Bearer ${cfg.apiKey}` };
  switch (cfg.provider) {
    case "RESEND":
    case "CUSTOM":
      return { url, init: json({ from: cfg.from, to: [msg.to], subject: msg.subject, text: msg.text }, auth) };
    case "SENDGRID":
      return { url, init: json({
        personalizations: [{ to: [{ email: msg.to }] }],
        from: sender.name ? { email: sender.email, name: sender.name } : { email: sender.email },
        subject: msg.subject,
        content: [{ type: "text/plain", value: msg.text }],
      }, auth) };
    case "BREVO":
      return { url, init: json({
        sender: sender.name ? { email: sender.email, name: sender.name } : { email: sender.email },
        to: [{ email: msg.to }],
        subject: msg.subject,
        textContent: msg.text,
      }, { "api-key": cfg.apiKey }) };
    case "POSTMARK":
      return { url, init: json({ From: cfg.from, To: msg.to, Subject: msg.subject, TextBody: msg.text }, {
        "x-postmark-server-token": cfg.apiKey,
      }) };
    case "MAILGUN": {
      const body = new URLSearchParams({ from: cfg.from, to: msg.to, subject: msg.subject, text: msg.text }).toString();
      return { url, init: {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`api:${cfg.apiKey}`).toString("base64")}` },
        body,
      } };
    }
    default: throw new Error("不支持的 HTTP 邮件服务商");
  }
}
