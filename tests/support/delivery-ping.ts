import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";

/** 仅在随机隔离库的真实Webhook路由上验证连通性，不模拟外部交付完成。 */
export async function verifyDeliveryPing(
  app: FastifyInstance,
  sourceId: string,
  secret: string,
) {
  const { db } = await import("../../src/db/index.ts");
  const { deliveryEvidence, deliveryReceipt, deliverySource } =
    await import("../../src/db/schema.ts");
  const { eq } = await import("drizzle-orm");
  const snapshot = async () => ({
    evidence: await db
      .select({ id: deliveryEvidence.id })
      .from(deliveryEvidence),
    receipts: await db.select({ id: deliveryReceipt.id }).from(deliveryReceipt),
  });
  const before = await snapshot();
  const raw =
    '{ "zen": "Keep it logically awesome.", "hook_id": 42, "hook": { "type": "Repository", "id": 42 }, "repository": { "full_name": "acme/app" } }';
  const headers = (body: string) => ({
    "content-type": "application/json",
    "x-github-event": "ping",
    "x-github-delivery": "connection-ping",
    "x-hub-signature-256":
      "sha256=" + createHmac("sha256", secret).update(body).digest("hex"),
  });
  const request = {
    method: "POST" as const,
    url: "/api/v1/delivery/hooks/github/" + sourceId,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await app.inject({
      ...request,
      payload: raw,
      headers: headers(raw),
    });
    assert.equal(
      response.statusCode,
      200,
      "合法签名的GitHub ping应被接收：" + response.body,
    );
    assert.deepEqual(response.json(), { event: "ping", accepted: true });
  }
  for (const payload of [
    raw.replace("acme/app", "other/app"),
    '{ "zen": "organization ping" }',
  ]) {
    const response = await app.inject({
      ...request,
      payload,
      headers: headers(payload),
    });
    assert.equal(response.statusCode, 403, "非绑定仓库的ping必须拒绝");
  }
  const tampered = await app.inject({
    ...request,
    payload: raw + " ",
    headers: headers(raw),
  });
  assert.equal(tampered.statusCode, 403, "ping签名仍需按原始字节校验");
  const unsignedHeaders: Record<string, string> = headers(raw);
  delete unsignedHeaders["x-hub-signature-256"];
  assert.equal(
    (await app.inject({ ...request, payload: raw, headers: unsignedHeaders }))
      .statusCode,
    403,
  );
  const unknown = await app.inject({
    ...request,
    payload: raw,
    headers: { ...headers(raw), "x-github-event": "unknown" },
  });
  assert.equal(unknown.statusCode, 403);
  // 只调整本轮隔离测试的来源；失效来源不能通过连接探测。
  await db
    .update(deliverySource)
    .set({ enabled: false })
    .where(eq(deliverySource.id, sourceId));
  try {
    assert.equal(
      (await app.inject({ ...request, payload: raw, headers: headers(raw) }))
        .statusCode,
      403,
    );
  } finally {
    await db
      .update(deliverySource)
      .set({ enabled: true })
      .where(eq(deliverySource.id, sourceId));
  }
  assert.deepEqual(
    await snapshot(),
    before,
    "ping和拒绝请求都不能生成交付证据或交付回执",
  );
}
