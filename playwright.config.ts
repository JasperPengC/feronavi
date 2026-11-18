import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  globalSetup: "./tests/e2e/global-setup.ts",
  outputDir: "test-results",
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    locale: "zh-CN",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
