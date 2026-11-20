/** 公开 readiness：数据库必须就绪；可选缓存降级不影响就绪，不暴露业务数据。 */
import type { FastifyInstance } from "fastify";
import { pgSqlProbe } from "../repos/health.repo.ts";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async (_req, reply) => {
    const started = Date.now();
    try {
      await pgSqlProbe();
      return reply.header("cache-control", "no-store").send({
        ok: true, database: "ok", uptimeSeconds: Math.round(process.uptime()),
        latencyMs: Date.now() - started, now: new Date().toISOString(),
      });
    } catch {
      return reply.status(503).header("cache-control", "no-store").send({
        ok: false, database: "down", uptimeSeconds: Math.round(process.uptime()), now: new Date().toISOString(),
      });
    }
  });
}
