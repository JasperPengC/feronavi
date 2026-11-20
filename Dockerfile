# ─────────────────────────────────────────────────────────────
# Feronavi · 应用镜像（app 与 worker 共用）
#
# 形态：单个 Node 服务同时提供 REST API、MCP 端点与 SPA 静态文件。
#   - 服务端：Fastify（提供真实 Node req/res，MCP Streamable-HTTP 依赖它）
#   - 前端：Vite 构建的静态 SPA，由 Fastify 托管（内部系统不需要 SSR）
#   - worker：同镜像、不同入口（node dist-server/server/worker.js）
#
# 四阶段：全量依赖 → 构建 → 生产依赖 → 运行
#   devDependencies 与构建工具留在前三个阶段，运行层只带生产依赖。
#
# ─────────────────────────────────────────────────────────────
# syntax=docker/dockerfile:1

ARG NODE_VERSION=24
ARG RUNTIME_VARIANT=alpine3.24

# ── ① 全量依赖（含 dev，供构建）────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN pnpm install --frozen-lockfile --registry=${NPM_REGISTRY}

# 开发容器：保留开发依赖和包管理器，源码由工作区挂载。
FROM deps AS development
ENV NODE_ENV=development
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
RUN mkdir -p /data && chown node:node /workspace /data
USER node
CMD ["sleep", "infinity"]

# ── ② 构建：Vite 打前端，tsc 编服务端 ──────────────────────────
FROM deps AS builder
COPY . .
ENV NODE_ENV=production
RUN pnpm build

# ── ③ 生产依赖（剪掉 devDependencies）─────────────────────────
FROM node:${NODE_VERSION}-${RUNTIME_VARIANT} AS prod-deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN pnpm install --frozen-lockfile --prod --registry=${NPM_REGISTRY}

# ── ④ 运行 ────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-${RUNTIME_VARIANT} AS runner

# 生产原生模块在同一 musl 基线安装；不从 glibc 构建层复制 node_modules。
# 构建工具与 Debian 系统包只保留在构建/开发阶段。
RUN apk upgrade --no-cache \
    && apk add --no-cache 'libcrypto3>=3.5.9-r1' 'libssl3>=3.5.9-r1'

ARG FERONAVI_VERSION=dev
ENV NODE_ENV=production \
    FERONAVI_VERSION=${FERONAVI_VERSION} \
    DATA_DIR=/data \
    PORT=3000

WORKDIR /app

# 非 root 运行：uid/gid 1000，与数据卷属主一致
# 官方 Node 镜像已提供 uid/gid 1000 的 node 用户。
RUN mkdir -p /data && chown 1000:1000 /data

COPY --from=prod-deps --chown=1000:1000 /app/node_modules ./node_modules
COPY --from=builder   --chown=1000:1000 /app/dist        ./dist
COPY --from=builder   --chown=1000:1000 /app/dist-server ./dist-server
COPY --from=builder   --chown=1000:1000 /app/drizzle     ./drizzle
COPY --chown=1000:1000 package.json LICENSE NOTICE ./

USER 1000:1000
EXPOSE 3000
VOLUME ["/data"]

# 优雅停机：应用需处理 SIGTERM，正在处理的请求完成后退出
STOPSIGNAL SIGTERM

# server.js 同时提供 REST、MCP 与 SPA；worker 用同一镜像 + 不同入口：
#   docker run ... feronavi-app node dist-server/server/worker.js
CMD ["node", "dist-server/server/server.js"]
