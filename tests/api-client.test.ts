import { afterEach, describe, expect, it, vi } from "vitest";
import { apiDelete, apiPost, apiPut, apiUpload, ApiError } from "../src/client/lib/api.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => { vi.unstubAllGlobals(); document.cookie = "csrf_token=; Max-Age=0; path=/"; });

describe("API 请求契约", () => {
  it("关闭 2FA 的 DELETE 发送对象，服务端能读出 password", async () => {
    vi.stubGlobal("fetch", async (_url: URL, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return typeof body === "object" && body.password === "current-password"
        ? new Response(null, { status: 204 }) : json({ code: "VALIDATION", message: "需要提供当前密码" }, 400);
    });
    await expect(apiDelete("/api/v1/auth/2fa", { password: "current-password" })).resolves.toBeUndefined();
  });

  it("无请求体的 DELETE 不增加 JSON 请求体", async () => {
    vi.stubGlobal("fetch", async (_url: URL, init: RequestInit) => {
      expect(init.body).toBeUndefined();
      expect(new Headers(init.headers).has("content-type")).toBe(false);
      return new Response(null, { status: 204 });
    });
    await apiDelete("/api/v1/pages/p1");
  });

  it("CSRF 失效后使用新令牌重发完整 JSON 写请求", async () => {
    document.cookie = "csrf_token=expired; path=/";
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
      if (url.pathname === "/api/v1/auth/csrf") return json({ csrfToken: "fresh" });
      bodies.push(JSON.parse(String(init.body)));
      return new Headers(init.headers).get("x-csrf-token") === "fresh"
        ? json({ saved: true }) : json({ message: "Invalid CSRF token" }, 403);
    });
    await expect(apiPut("/api/v1/pages/p1/permissions", { permissions: [] })).resolves.toEqual({ saved: true });
    expect(bodies).toEqual([{ permissions: [] }, { permissions: [] }]);
  });

  it("刷新后仍拒绝 CSRF 时停止重试并保留 ApiError", async () => {
    let writes = 0;
    vi.stubGlobal("fetch", async (url: URL) => {
      if (url.pathname === "/api/v1/auth/csrf") return json({ csrfToken: "fresh" });
      writes += 1;
      return json({ code: "CSRF", message: "Invalid CSRF token" }, 403);
    });
    await expect(apiPost("/api/v1/example", {})).rejects.toMatchObject({ name: "ApiError", status: 403 });
    expect(writes).toBe(2);
  });

  it("重试收到反向代理 HTML 错误时仍抛出带 HTTP 状态的 ApiError", async () => {
    let writes = 0;
    vi.stubGlobal("fetch", async (url: URL) => {
      if (url.pathname === "/api/v1/auth/csrf") return json({ csrfToken: "fresh" });
      return ++writes === 1 ? json({ message: "Invalid CSRF token" }, 403) : new Response("<html>Bad gateway</html>", { status: 502 });
    });
    await expect(apiPost("/api/v1/example", {})).rejects.toMatchObject({ name: "ApiError", status: 502, code: "INTERNAL" });
  });

  it("JSON null 错误响应不会泄露 TypeError", async () => {
    vi.stubGlobal("fetch", async () => json(null, 503));
    await expect(apiPost("/api/v1/example", {})).rejects.toBeInstanceOf(ApiError);
  });

  it("multipart 上传同样恢复 CSRF，重试保留文件且让浏览器生成 boundary", async () => {
    const form = new FormData();
    form.append("file", new File(["hello"], "hello.txt"));
    vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
      if (url.pathname === "/api/v1/auth/csrf") return json({ csrfToken: "fresh" });
      expect(init.body).toBe(form);
      expect(new Headers(init.headers).has("content-type")).toBe(false);
      return new Headers(init.headers).get("x-csrf-token") === "fresh"
        ? json({ id: "attachment-1" }) : json({ message: "Invalid CSRF token" }, 403);
    });
    await expect(apiUpload("/api/v1/attachments", form)).resolves.toEqual({ id: "attachment-1" });
  });
});
