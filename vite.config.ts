import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { mermaidParserGrammars } from "./scripts/build-tools/mermaid-parser-grammars.ts";

/**
 * 前端构建：产出静态 SPA，由 Fastify 托管（内部系统不需要 SSR）。
 *
 * 开发时把 `/api` 代理到后端，避免跨域与 Cookie 问题；
 * 生产构建产物在 `dist/`，由 `@fastify/static` 直接托管。
 */
export default defineConfig({
  plugins: [react(), mermaidParserGrammars()],
  resolve: {
    alias: [{ find: "elkjs/lib/elk.bundled.js", replacement: fileURLToPath(new URL("./src/client/lib/mermaid-elk.ts", import.meta.url)) }],
  },
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
          if (id.startsWith("\0mermaid-parser-grammar:")) return "mermaid-parser-grammars";
          if (!id.includes("/node_modules/")) return undefined;
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) return "framework";
          if (id.includes("/@tanstack/")) return "tanstack";
          if (id.includes("/@dnd-kit/")) return "dnd-kit";
          if (id.includes("/zod/")) return "validation";
          if (id.includes("/yjs/") || id.includes("/lib0/")) return "collaboration";
          const parserChunk = /\/@mermaid-js\/parser\/dist\/chunks\/mermaid-parser\.core\/([^/]+)\.mjs/.exec(id);
          if (parserChunk) return `mermaid-parser-${parserChunk[1]}`;
          if (id.includes("/@mermaid-js/parser/")) return "mermaid-parser";
          if (id.includes("/chevrotain/") || id.includes("/@chevrotain/")) return "mermaid-grammar";
          // Mermaid已按源码模块预分块；保留共享模块边界，避免核心重新合并成大包。
          const mermaidChunk = /\/mermaid\/dist\/chunks\/mermaid\.core\/(chunk-[^/]+)\.mjs/.exec(id);
          if (mermaidChunk) return `mermaid-${mermaidChunk[1]}`;
          // 其余依赖保留动态导入边界；Mermaid按图表类型按需加载，避免首屏拉取全部绘图库。
          return undefined;
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
