import { createIsolatedDatabase } from "../support/isolated-database.ts";
import { startIsolatedApp } from "../support/isolated-app.ts";

export default async function globalSetup() {
  const database = await createIsolatedDatabase();
  let app: Awaited<ReturnType<typeof startIsolatedApp>> | undefined;
  const cleanup = async () => { await app?.stop(); await database.cleanup(); };
  try {
    app = await startIsolatedApp(database);
    const { baseURL } = app;
    process.env.E2E_BASE_URL = baseURL;
    const response = await fetch(`${baseURL}/api/v1/setup/complete`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        admin: { username: "browser-admin", email: "browser@example.invalid", name: "浏览器管理员", password: "browser-initial-password" },
        org: { name: "浏览器测试组织", defaultLocale: "zh-CN", defaultTimezone: "Asia/Shanghai" },
      }),
    });
    if (response.status !== 201) throw new Error(`测试安装失败：${response.status} ${await response.text()}`);
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
