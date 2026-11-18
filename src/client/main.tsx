/** 前端入口：QueryClient + Router */
import React from "react";
import "./styles/index.css";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router.tsx";
import { ErrorBoundary } from "./lib/ErrorBoundary.tsx";
import { watchSystemTheme } from "./lib/theme.ts";

// 启动占位由 index.html 提供，React 挂载前展示；这里显式移除（不依赖 createRoot 清空容器的行为）
document.getElementById("boot-splash")?.remove();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 服务端数据以「失效」为主要刷新手段，不做窗口聚焦轮询
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 10_000,
    },
  },
});

/**
 * 应用级注册系统主题监听：**必须放在组件之外**。
 * 原先只注册在 ThemeToggle 里 —— 组件卸载（或压根没挂载）时就完全不跟随系统，
 * 表现为"选了跟随系统但永远不变"。
 */
watchSystemTheme();

// PWA：生产构建注册 service worker（开发模式不注册，避免缓存干扰 HMR）
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => { /* 离线壳失败不影响主流程 */ });
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
