// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { SMTPServer } from "smtp-server";
const state = vi.hoisted(() => ({ settings: {} as Record<string, unknown> }));
vi.mock("../src/server/services/setting.service.ts", () => ({ getSettingRaw: async (key: string) => state.settings[key] ?? null }));
import { sendMail } from "../src/server/services/mail.service.ts";

let smtp: SMTPServer | undefined;
afterEach(async () => {
  if (smtp) await new Promise<void>(resolve => smtp!.close(() => resolve()));
  smtp = undefined;
  vi.restoreAllMocks();
});

it("拒绝向未提供 STARTTLS 的 SMTP 服务暴露认证信息", async () => {
  let authenticationAttempts = 0;
  smtp = new SMTPServer({
    disabledCommands: ["STARTTLS"], allowInsecureAuth: true,
    onAuth(_auth, _session, callback) { authenticationAttempts++; callback(null, { user: "test" }); },
  });
  smtp.on("error", () => {});
  await new Promise<void>(resolve => smtp!.listen(0, "127.0.0.1", resolve));
  const address = smtp.server.address();
  if (!address || typeof address === "string") throw new Error("测试 SMTP 未监听");
  state.settings = { "smtp.host": "127.0.0.1", "smtp.port": address.port,
    "smtp.user": "test", "smtp.password": "fixture-password", "smtp.from": "fixture@example.test" };
  vi.spyOn(console, "error").mockImplementation(() => {});
  const result = await sendMail({ to: "sink@example.test", subject: "fixture", text: "fixture" });
  expect(result.ok).toBe(false);
  expect(authenticationAttempts).toBe(0);
});

it("拒绝自签 SMTP 证书且不尝试认证", async () => {
  let authenticationAttempts = 0;
  // smtp-server 的默认测试证书为自签证书，客户端必须拒绝。
  smtp = new SMTPServer({
    onAuth(_auth, _session, callback) { authenticationAttempts++; callback(null, { user: "test" }); },
  });
  smtp.on("error", () => {});
  await new Promise<void>(resolve => smtp!.listen(0, "127.0.0.1", resolve));
  const address = smtp.server.address();
  if (!address || typeof address === "string") throw new Error("测试 SMTP 未监听");
  state.settings = { "smtp.host": "127.0.0.1", "smtp.port": address.port,
    "smtp.user": "test", "smtp.password": "fixture-password", "smtp.from": "fixture@example.test" };
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect((await sendMail({ to: "sink@example.test", subject: "fixture", text: "fixture" })).ok).toBe(false);
  expect(authenticationAttempts).toBe(0);
});
