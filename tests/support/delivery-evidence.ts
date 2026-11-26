import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
assert.match(
  new URL(process.env.DATABASE_URL ?? "postgres://invalid/").pathname.slice(1),
  /^feronavi_test_[a-f0-9]{32}$/u,
);
await (
  await import("../../src/server/application/bootstrap-business-effects.ts")
).bootstrapBusinessEffects();
const { db, sql } = await import("../../src/db/index.ts");
const schema = await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { loadActor } = await import("../../src/server/auth/actor-loader.ts");
const { createProject } =
  await import("../../src/server/services/project.service.ts");
const wi = await import("../../src/server/services/work-item.service.ts");
const sources =
  await import("../../src/server/services/delivery-source.service.ts");
const evidence =
  await import("../../src/server/services/delivery-evidence.service.ts");
const hooks =
  await import("../../src/server/services/delivery-webhook.service.ts");
const integrations =
  await import("../../src/server/services/integration.service.ts");
const code = (value: string) => (error: unknown) =>
  (error as { code?: string }).code === value;
try {
  const [admin] = await db
    .select()
    .from(schema.role)
    .where(eq(schema.role.key, "ADMIN"));
  const [m, other] = await db
    .insert(schema.member)
    .values([
      {
        username: "delivery-owner",
        name: "交付验收",
        passwordHash: "no-login",
        status: "ACTIVE",
      },
      {
        username: "delivery-outsider",
        name: "外部",
        passwordHash: "no-login",
        status: "ACTIVE",
      },
    ])
    .returning();
  await db
    .insert(schema.roleAssignment)
    .values({
      memberId: m!.id,
      roleId: admin!.id,
      scopeType: "ORG",
      scopeId: null,
    });
  const actor = (await loadActor(m!.id))!,
    denied = (await loadActor(other!.id))!,
    readonly = {
      ...actor,
      permissions: new Set<string>(),
      rolePermissions: new Map(),
    };
  const p = await createProject(actor, { key: "DEL", name: "交付验收" }),
    foreign = await createProject(actor, { key: "DELX", name: "外部项目" });
  const task = await wi.createWorkItem(actor, p.id, {
      type: "TASK",
      title: "交付原始证据",
    }),
    foreignTask = await wi.createWorkItem(actor, foreign.id, {
      type: "TASK",
      title: "不能关联",
    });
  const input = {
    kind: "CI",
    title: "Agent本地测试",
    repository: "acme/app",
    commitSha: "a".repeat(40),
    build: "local-a",
    status: "SUCCEEDED",
    url: "https://example.com/log/1",
    workItemIds: [task.id],
  };
  await assert.rejects(
    evidence.createDeliveryEvidence(readonly, p.id, input),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    evidence.createDeliveryEvidence(actor, p.id, {
      ...input,
      verification: "PROVIDER_API",
    }),
    code("VALIDATION"),
  );
  await assert.rejects(
    evidence.createDeliveryEvidence(actor, p.id, {
      ...input,
      url: "/Users/local/log.txt",
    }),
    code("VALIDATION"),
  );
  await assert.rejects(
    evidence.createDeliveryEvidence(actor, p.id, {
      ...input,
      workItemIds: [foreignTask.id],
    }),
    code("FORBIDDEN"),
  );
  const self = await evidence.createDeliveryEvidence(actor, p.id, input);
  assert.equal(self.verification, "SELF_REPORTED");
  assert.equal(self.sourceId, null);
  assert.equal(self.workItems[0]!.id, task.id);
  await assert.rejects(
    evidence.getDeliveryEvidence(denied, p.id, self.id),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    evidence.getDeliveryEvidence(actor, foreign.id, self.id),
    code("FORBIDDEN"),
  );
  await evidence.linkDeliveryEvidence(actor, p.id, self.id, [task.id]);
  assert.equal(
    (await evidence.getDeliveryEvidence(actor, p.id, self.id)).workItems.length,
    1,
  );
  const integration = await integrations.createIntegration(actor, {
    kind: "GITHUB",
    name: "签名测试",
    baseUrl: "https://8.8.8.8",
    token: "test-only-token",
    projectId: p.id,
    config: { repo: "acme/app" },
  });
  const secret = "test-only-webhook-secret-12345678";
  let source = await sources.configureDeliverySource(actor, p.id, {
    integrationId: integration.id,
    webhookSecret: secret,
    expectedVersion: 0,
  });
  assert.equal(source.version, 1);
  assert.equal(source.configCurrent, true);
  assert.equal(JSON.stringify(source).includes(secret), false);
  await assert.rejects(
    sources.configureDeliverySource(actor, p.id, {
      integrationId: integration.id,
      webhookSecret: secret,
      expectedVersion: 0,
    }),
    code("VERSION_CONFLICT"),
  );
  let calls = 0;
  let conclusion = "failure";
  let updated = "2026-11-25T10:00:00Z";
  let attempt = 1;
  const fetchImpl: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(options?.redirect, "error");
    assert.equal(
      new Headers(options?.headers).get("authorization"),
      "Bearer test-only-token",
    );
    const pathname = new URL(String(url)).pathname;
    if (pathname === "/repos/acme/app/actions/runs/10")
      return Response.json({
        id: 10,
        name: "Build",
        workflow_id: 7,
        head_sha: "a".repeat(40),
        run_attempt: attempt,
        status: "completed",
        conclusion,
        updated_at: updated,
        html_url: "https://github.com/acme/app/actions/runs/10",
        repository: { full_name: "acme/app" },
      });
    if (pathname === "/repos/acme/app/pulls/2")
      return Response.json({
        number: 2,
        title: "Fix",
        merged: true,
        state: "closed",
        merge_commit_sha: "a".repeat(40),
        head: { sha: "b".repeat(40) },
        base: { repo: { full_name: "acme/app" } },
        updated_at: updated,
        html_url: "https://github.com/acme/app/pull/2",
      });
    if (pathname === "/repos/acme/app/commits/" + "a".repeat(40))
      return Response.json({
        sha: "a".repeat(40),
        commit: { message: "Fix", committer: { date: updated } },
        html_url: "https://github.com/acme/app/commit/" + "a".repeat(40),
      });
    if (pathname === "/repos/acme/app/deployments/5")
      return Response.json({
        id: 5,
        sha: "a".repeat(40),
        environment: "production",
        updated_at: updated,
      });
    if (pathname === "/repos/acme/app/deployments/5/statuses")
      return Response.json([
        {
          id: 99,
          state: "success",
          created_at: updated,
          updated_at: updated,
          environment: "production",
          log_url: "https://example.com/deploy/5",
        },
      ]);
    throw Error("unexpected URL " + pathname);
  };
  const body = (event: string) =>
    Buffer.from(
      JSON.stringify({
        repository: { full_name: "acme/app" },
        ...(event === "workflow_run"
          ? { workflow_run: { id: 10, conclusion: "success" } }
          : event === "pull_request"
            ? { number: 2 }
            : event === "push"
              ? { after: "a".repeat(40) }
              : { deployment: { id: 5 }, deployment_status: { id: 99 } }),
      }),
    );
  const headers = (event: string, id: string, raw: Buffer) => ({
    "x-github-event": event,
    "x-github-delivery": id,
    "x-hub-signature-256":
      "sha256=" + createHmac("sha256", secret).update(raw).digest("hex"),
  });
  const raw = body("workflow_run");
  const h = headers("workflow_run", "event-1", raw);
  await assert.rejects(
    hooks.receiveGitHubDelivery(
      source.id,
      { ...h, "x-hub-signature-256": "sha256=bad" },
      raw,
      { fetchImpl },
    ),
    code("FORBIDDEN"),
  );
  assert.equal(calls, 0);
  const wrong = Buffer.from(
    JSON.stringify({
      repository: { full_name: "other/repo" },
      workflow_run: { id: 10 },
    }),
  );
  await assert.rejects(
    hooks.receiveGitHubDelivery(
      source.id,
      headers("workflow_run", "wrong", wrong),
      wrong,
      { fetchImpl },
    ),
    code("FORBIDDEN"),
  );
  assert.equal(calls, 0);
  const failed = await hooks.receiveGitHubDelivery(source.id, h, raw, {
    fetchImpl,
  });
  assert.equal(failed.replayed, false);
  const saved = await evidence.getDeliveryEvidence(
    actor,
    p.id,
    failed.evidenceId,
  );
  assert.equal(saved.status, "FAILED");
  assert.equal(saved.verification, "PROVIDER_API");
  assert.equal(saved.details.workflowId, 7);
  assert.equal(saved.sourceCurrent, true);
  const count = calls;
  assert.equal(
    (await hooks.receiveGitHubDelivery(source.id, h, raw, { fetchImpl }))
      .evidenceId,
    saved.id,
  );
  assert.equal(calls, count);
  const different = Buffer.from(
    JSON.stringify({ ...JSON.parse(raw.toString()), action: "requested" }),
  );
  await assert.rejects(
    hooks.receiveGitHubDelivery(
      source.id,
      headers("workflow_run", "event-1", different),
      different,
      { fetchImpl },
    ),
    code("CONFLICT"),
  );
  conclusion = "success";
  updated = "2026-11-25T09:00:00Z";
  const old = await hooks.receiveGitHubDelivery(
    source.id,
    headers("workflow_run", "old-success", raw),
    raw,
    { fetchImpl },
  );
  assert.notEqual(old.evidenceId, saved.id);
  assert.equal(
    (await evidence.getDeliveryEvidence(actor, p.id, saved.id)).status,
    "FAILED",
  );
  attempt = 2;
  updated = "2026-11-25T11:00:00Z";
  const twice = await Promise.all(
    [1, 2].map(() =>
      hooks.receiveGitHubDelivery(
        source.id,
        headers("workflow_run", "attempt-2", raw),
        raw,
        { fetchImpl },
      ),
    ),
  );
  assert.equal(twice[0].evidenceId, twice[1].evidenceId);
  assert.equal(twice.filter((v) => v.replayed).length, 1);
  await evidence.linkDeliveryEvidence(actor, p.id, twice[0].evidenceId, [
    task.id,
  ]);
  for (const event of ["pull_request", "push", "deployment_status"]) {
    const raw = body(event);
    const receipt = await hooks.receiveGitHubDelivery(
      source.id,
      headers(event, event, raw),
      raw,
      { fetchImpl },
    );
    const item = await evidence.getDeliveryEvidence(
      actor,
      p.id,
      receipt.evidenceId,
    );
    assert.equal(item.status, "SUCCEEDED");
    assert.equal(item.commitSha, "a".repeat(40));
  }
  const list = await evidence.listDeliveryEvidence(actor, p.id, {
    workItemId: task.id,
    limit: 1,
  });
  assert.equal(list.items.length, 1);
  assert.ok(list.nextCursor);
  const next = await evidence.listDeliveryEvidence(actor, p.id, {
    workItemId: task.id,
    limit: 1,
    before: list.nextCursor,
  });
  assert.equal(next.items.length, 1);
  assert.notEqual(next.items[0]!.id, list.items[0]!.id);
  await assert.rejects(
    db
      .update(schema.deliveryEvidence)
      .set({ status: "SUCCEEDED" })
      .where(eq(schema.deliveryEvidence.id, saved.id)),
  );
  const changedFetch: typeof fetch = async (...args) => {
    const result = await fetchImpl(...args);
    await integrations.updateIntegration(actor, integration.id, {
      name: "changed",
    });
    return result;
  };
  await assert.rejects(
    hooks.receiveGitHubDelivery(
      source.id,
      headers("workflow_run", "stale", raw),
      raw,
      { fetchImpl: changedFetch },
    ),
    code("CONFLICT"),
  );
  const [receiptCount] =
    await sql`select count(*)::int as count from delivery_receipt where delivery_id='stale'`;
  assert.equal(receiptCount!.count, 0);
  assert.equal(
    (await evidence.getDeliveryEvidence(actor, p.id, saved.id)).sourceCurrent,
    false,
  );
  source = await sources.configureDeliverySource(actor, p.id, {
    integrationId: integration.id,
    webhookSecret: secret,
    expectedVersion: 1,
  });
  assert.equal(source.version, 2);
  await hooks.receiveGitHubDelivery(
    source.id,
    headers("workflow_run", "refreshed", raw),
    raw,
    { fetchImpl },
  );
  source = await sources.configureDeliverySource(actor, p.id, {
    integrationId: integration.id,
    expectedVersion: 2,
    enabled: false,
  });
  assert.equal(source.enabled, false);
  await assert.rejects(
    hooks.receiveGitHubDelivery(
      source.id,
      headers("workflow_run", "disabled", raw),
      raw,
      { fetchImpl },
    ),
    code("FORBIDDEN"),
  );
  await (
    await import("./delivery-contracts.ts")
  ).verifyDeliveryContracts(actor, p.id, foreign.id, task.id, integration.id);
  const spare = await integrations.createIntegration(actor, {
    kind: "GITHUB",
    name: "恢复目标",
    baseUrl: "https://8.8.8.8",
    token: "test-only-token",
    projectId: p.id,
    config: { repo: "acme/restored" },
  });
  const restored = await sources.configureDeliverySource(actor, p.id, {
    integrationId: spare.id,
    webhookSecret: secret,
    expectedVersion: 0,
  });
  await db
    .update(schema.deliverySource)
    .set({ integrationId: null, webhookSecretEncrypted: null, enabled: false })
    .where(eq(schema.deliverySource.id, restored.id));
  await assert.rejects(
    sources.configureDeliverySource(actor, p.id, {
      sourceId: restored.id,
      integrationId: integration.id,
      expectedVersion: 1,
      webhookSecret: secret,
    }),
    code("CONFLICT"),
  );
  const rebound = await sources.configureDeliverySource(actor, p.id, {
    sourceId: restored.id,
    integrationId: spare.id,
    expectedVersion: 1,
    webhookSecret: secret,
  });
  assert.equal(rebound.id, restored.id);
  assert.equal(rebound.version, 2);
  assert.equal(rebound.configCurrent, true);
  await assert.rejects(
    integrations.updateIntegration(actor, spare.id, {
      projectId: foreign.id,
      token: "test-only-other-token",
    }),
    code("BLOCKED_BY_PREREQUISITE"),
  );
  await assert.rejects(
    integrations.deleteIntegration(actor, spare.id),
    code("BLOCKED_BY_PREREQUISITE"),
  );
  console.log("delivery evidence domain passed");
} finally {
  await sql.end({ timeout: 5 });
}
