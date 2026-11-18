import { describe, it, expect } from "vitest";
import { buildHttpMailRequest } from "../src/server/services/mail-http.ts";

const msg = { to: "to@example.com", subject: "主题", text: "正文" };

describe("HTTP 邮件适配器", () => {
  it("Resend：Bearer + Resend JSON", () => {
    const r = buildHttpMailRequest({ provider: "RESEND", endpoint: null, domain: null, apiKey: "re_x", from: "Feronavi <noreply@example.com>" }, msg);
    expect(r.url).toBe("https://api.resend.com/emails");
    expect(r.init.headers).toMatchObject({ authorization: "Bearer re_x" });
    expect(JSON.parse(String(r.init.body))).toEqual({ from: "Feronavi <noreply@example.com>", to: ["to@example.com"], subject: "主题", text: "正文" });
  });
  it("SendGrid：personalizations + Bearer", () => {
    const r = buildHttpMailRequest({ provider: "SENDGRID", endpoint: null, domain: null, apiKey: "sg", from: "noreply@example.com" }, msg);
    expect(r.url).toContain("api.sendgrid.com");
    expect(JSON.parse(String(r.init.body))).toMatchObject({ personalizations: [{ to: [{ email: "to@example.com" }] }], subject: "主题" });
  });
  it("Mailgun：域名进入 URL + Basic 表单", () => {
    const r = buildHttpMailRequest({ provider: "MAILGUN", endpoint: null, domain: "mg.example.com", apiKey: "mgkey", from: "noreply@example.com" }, msg);
    expect(r.url).toBe("https://api.mailgun.net/v3/mg.example.com/messages");
    expect(String(r.init.headers && (r.init.headers as Record<string, string>).authorization)).toMatch(/^Basic /);
    expect(String(r.init.body)).toContain("to=to%40example.com");
  });
  it("Postmark / Brevo 使用各自认证头", () => {
    const p = buildHttpMailRequest({ provider: "POSTMARK", endpoint: null, domain: null, apiKey: "pm", from: "noreply@example.com" }, msg);
    expect(p.init.headers).toMatchObject({ "x-postmark-server-token": "pm" });
    const b = buildHttpMailRequest({ provider: "BREVO", endpoint: null, domain: null, apiKey: "brevo", from: "noreply@example.com" }, msg);
    expect(b.init.headers).toMatchObject({ "api-key": "brevo" });
  });
  it("自定义 endpoint 可覆盖；缺 Mailgun 域名报错", () => {
    const c = buildHttpMailRequest({ provider: "CUSTOM", endpoint: "https://mail.internal/api/send", domain: null, apiKey: "k", from: "noreply@example.com" }, msg);
    expect(c.url).toBe("https://mail.internal/api/send");
    expect(() => buildHttpMailRequest({ provider: "MAILGUN", endpoint: null, domain: null, apiKey: "k", from: "noreply@example.com" }, msg)).toThrow(/域名/);
  });
});
