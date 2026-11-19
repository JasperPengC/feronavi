import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * 前端构建：产出静态 SPA，由 Fastify 托管（内部系统不需要 SSR）。
 *
 * 开发时把 `/api` 代理到后端，避免跨域与 Cookie 问题；
 * 生产构建产物在 `dist/`，由 `@fastify/static` 直接托管。
 */
export default defineConfig({
  plugins: [react()],
  // 源码在 src/client，产物到 dist（与 Fastify 的静态目录约定一致）
  root: ".",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      // zod 发行包中的 @__PURE__ 注释位置不符合 Rollup 的注释解析规则，
      // Rollup 会安全移除该注释；只过滤这个已知的上游噪声，保留其他告警。
      onwarn(warning, warn) {
        if (warning.code === "INVALID_ANNOTATION" && warning.id?.includes("/node_modules/zod/")) return;
        warn(warning);
      },
      output: {
        // 共享依赖从入口拆出，避免首屏入口被编辑器和协作依赖撑大。
        manualChunks(id) {
          if (!id.includes("/node_modules/")) return undefined;
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) return "framework";
          if (id.includes("/@tanstack/")) return "tanstack";
          if (id.includes("/@dnd-kit/")) return "dnd-kit";
          if (id.includes("/zod/")) return "validation";
          if (id.includes("/yjs/") || id.includes("/lib0/")) return "collaboration";
          return "vendor";
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // 隔离测试的构建与截图不应触发开发页面刷新。
    watch: { ignored: ["**/.cache/**", "**/test-results/**", "**/playwright-report/**", "**/docs/archive/**"] },
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://127.0.0.1:3000",
        changeOrigin: false,
      },
    },
  },
});
