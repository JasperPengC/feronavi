import "./_env.ts";
/** full数据集真实编码/恢复、运行任务排除后的并发重建；只向本次本地收端发HTTP。 */
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:http";
import { sql } from "../src/db/index.ts";
import { datasetRegistry, classifyDatabaseTable } from "../src/server/services/system-backup/registry.ts";
import { encryptSecret } from "../src/server/services/crypto.service.ts";
import { enqueue } from "../src/server/services/job.service.ts";
import { attemptDelivery, retryDue } from "../src/server/services/webhook.service.ts";
import { closeCache } from "../src/server/auth/cache.ts";

let receiver: ReturnType<typeof createServer> | undefined;
try {
  const [endpoint] = await sql`insert into webhook_endpoint (name,url,secret_encrypted,events)
    values ('full-restore-outbox','https://93.184.216.34/hooks',${encryptSecret("isolated-webhook-secret")},'["automation.rule"]'::jsonb) returning *`;
  const deliveries = await sql`insert into webhook_delivery (endpoint_id,event,payload)
    select ${endpoint!.id}, 'automation.rule', jsonb_build_object('test', n) from generate_series(1,2) n returning *`;
  for (const delivery of deliveries) await enqueue({ kind: "webhook.attempt", payload: { deliveryId: delivery.id }, dedupeKey: `webhook:${delivery.id}` });
  assert.equal(classifyDatabaseTable("job"), "exclude");
  const endpointDataset = datasetRegistry.find((entry) => entry.tableName === "webhook_endpoint")!;
  const deliveryDataset = datasetRegistry.find((entry) => entry.tableName === "webhook_delivery")!;
  const endpointArchive = JSON.parse(JSON.stringify(endpointDataset.encodeRow(endpoint!, { mode: "full", purpose: "migration" })));
  const archive = deliveries.map((delivery) => JSON.parse(JSON.stringify(deliveryDataset.encodeRow(delivery, { mode: "full", purpose: "migration" }))));
  // 按full迁移契约恢复真实数据集行，运行队列不迁移。
  await sql`delete from job where kind='webhook.attempt'`;
  await sql`delete from webhook_endpoint where id=${endpoint!.id}`;
  const restoredEndpoint = await endpointDataset.decodeRow(endpointArchive, { mode: "full", phase: "insert" });
  await sql`insert into webhook_endpoint select * from jsonb_populate_record(null::webhook_endpoint, ${JSON.stringify(restoredEndpoint)}::jsonb)`;
  for (const row of archive) {
    const restored = await deliveryDataset.decodeRow(row, { mode: "full", phase: "insert" });
    await sql`insert into webhook_delivery select * from jsonb_populate_record(null::webhook_delivery, ${JSON.stringify(restored)}::jsonb)`;
  }
  assert.equal((await sql`select count(*)::int as n from job where kind='webhook.attempt'`)[0]!.n, 0);
  await Promise.all(Array.from({ length: 20 }, () => retryDue()));
  const jobs = await sql`select dedupe_key,payload from job where kind='webhook.attempt'`;
  assert.equal(jobs.length, 2, "full恢复后，20个并发reconcile必须为两个PENDING投递重建唯一任务");
  assert.equal(new Set(jobs.map((job) => job.dedupe_key)).size, 2);
  await Promise.all(Array.from({ length: 10 }, () => retryDue()));
  assert.equal((await sql`select count(*)::int as n from job where kind='webhook.attempt'`)[0]!.n, 2, "已有待执行任务时不能再入队");
  console.log("PASS full数据集恢复且job排除后，20并发reconcile重建唯一任务，已有任务不重复");

  const received: string[] = [];
  let heldId: string | undefined;
  let heldStatus = 200;
  let arrive: (() => void) | undefined;
  let release: (() => void) | undefined;
  let held: Promise<void> | undefined;
  receiver = createServer((req, res) => {
    const deliveryId = String(req.headers["x-feronavi-delivery"]);
    received.push(deliveryId);
    req.resume();
    if (deliveryId === heldId) {
      arrive?.();
      void held!.then(() => { res.writeHead(heldStatus); res.end("accepted"); });
    } else { res.writeHead(200); res.end("accepted"); }
  });
  await new Promise<void>((resolve) => receiver!.listen(0, "127.0.0.1", resolve));
  const address = receiver.address(); assert.ok(address && typeof address !== "string");
  const deps = { fetchImpl: (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => fetch(`http://127.0.0.1:${address.port}/hooks`, {
    method: init?.method, headers: init?.headers, body: init?.body, signal: init?.signal,
  })) as typeof fetch };
  for (const delivery of deliveries) {
    assert.equal((await attemptDelivery(delivery.id, deps)).ok, true);
    assert.equal((await attemptDelivery(delivery.id, deps)).ok, true);
  }
  assert.equal(received.length, 2);
  assert.deepEqual(new Set(received), new Set(deliveries.map((delivery) => delivery.id)));
  assert.equal((await sql`select count(*)::int as n from webhook_delivery where endpoint_id=${endpoint!.id} and status='SUCCEEDED'`)[0]!.n, 2);
  console.log("PASS 本次本地收端收到两个稳定deliveryId；成功后重入没有重复HTTP");
  for (const status of [200, 503]) {
    const [normal] = await sql`insert into webhook_delivery (endpoint_id,event,payload) values (${endpoint!.id},'automation.rule','{}') returning id`;
    heldId = normal!.id; heldStatus = status;
    held = new Promise<void>((resolve) => { release = resolve; });
    const arrived = new Promise<void>((resolve) => { arrive = resolve; });
    const normalAttempt = attemptDelivery(normal!.id, deps);
    await arrived;
    await retryDue(); // 正常即时投递仍在等待HTTP，reconcile已发现PENDING并入队。
    const duplicates = Array.from({ length: 10 }, () => attemptDelivery(normal!.id, { ...deps, pendingOnly: true }));
    await delay(150);
    release!();
    const [result] = await Promise.all([normalAttempt, ...duplicates]);
    assert.equal(result!.ok, status === 200);
    assert.equal(received.filter((id) => id === normal!.id).length, 1, "恢复任务与正常即时投递并发时不能重复联系接收端");
    console.log(`PASS 正常投递HTTP ${status}与恢复任务并发，本地收端只收到一次${status === 503 ? "且遵守后续退避" : ""}`);
  }
} finally {
  if (receiver) await new Promise<void>((resolve) => receiver!.close(() => resolve()));
  await closeCache(); await sql.end();
}
