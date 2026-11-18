/**
 * Fastify 插件的类型增强加载点。
 *
 * 这些包通过 `declare module "fastify"` 注入 API（`req.cookies`、`reply.setCookie`、
 * `app.csrfProtection` …），但**只有被 import 过才会加载类型**。
 * 集中在这一处引用，保证全项目都能看到增强后的类型。
 */
import "@fastify/cookie";
import "@fastify/csrf-protection";
import "@fastify/rate-limit";
import "@fastify/helmet";
import "@fastify/static";
import "@fastify/multipart";

export {};
