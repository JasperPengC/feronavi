#!/usr/bin/env node
/** 健康检查 + 告警：失败时 POST ALERT_WEBHOOK_URL，适合 cron 每分钟/五分钟跑一次。 */
const base = process.env.HEALTH_URL ?? "http://127.0.0.1:3000/health";
const webhook = process.env.ALERT_WEBHOOK_URL ?? "";
try {
  const res = await fetch(base, { signal: AbortSignal.timeout(5000) });
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.ok) { console.log("[health] ok", body); process.exit(0); }
  throw new Error(`HTTP ${res.status} ${JSON.stringify(body)}`);
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  console.error("[health] FAILED", message);
  if (webhook) await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `Feronavi 健康检查失败：${message}`, service: "feronavi", at: new Date().toISOString() }) }).catch(() => {});
  process.exit(1);
}
