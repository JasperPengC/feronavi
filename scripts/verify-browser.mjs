import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { assertIsolatedTestEnvironment } from "./test-environment.mjs";
import { stopServer } from "../tests/support/isolated-app.ts";

/** Start an isolated Chrome CDP session without reusing stale debugging ports or profiles. */
export async function startVerifyBrowser(name) {
  assertIsolatedTestEnvironment();
  const port = await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local Chrome debugging port"));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
  const profile = await mkdtemp(join(process.env.FERONAVI_TEST_DIRECTORY, `chrome-${name}-`));
  const chrome = spawn(chromium.executablePath(), [
    "--headless=new", `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run", "--no-sandbox", "--disable-gpu", "--lang=zh-CN", "--window-size=1440,900", "about:blank",
  ], { stdio: "ignore" });
  let stopped;
  const interrupt = () => { void stop().finally(() => process.exit(130)); };
  const stop = () => stopped ??= (async () => {
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
    try { await stopServer(chrome); } finally { await rm(profile, { recursive: true, force: true }); }
  })();
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  chrome.once("error", () => { void stop(); });
  return { chrome, stop, host: `http://127.0.0.1:${port}` };
}
