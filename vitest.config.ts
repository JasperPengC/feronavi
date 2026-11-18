import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["tests/integration/**", "tests/e2e/**"],
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 15000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/client/routeTree.gen.ts", "src/db/seed*.ts"],
    },
  },
});
