import { z } from "zod";
import { DomainError, forbidden } from "../../shared/errors.ts";
import {
  deliverySha,
  deliveryUrl,
  type DeliveryEvidenceView,
} from "../../shared/schemas/delivery.ts";
import { safeOutboundFetch } from "../lib/safe-fetch.ts";
import { decryptSecret } from "./crypto.service.ts";
import type {
  DeliverySourceRow,
  DeliveryIntegrationRow,
} from "./delivery-source.service.ts";
export interface DeliveryFetchDeps {
  fetchImpl?: typeof fetch;
}
export type ProviderEvidence = Pick<
  DeliveryEvidenceView,
  | "kind"
  | "title"
  | "repository"
  | "commitSha"
  | "build"
  | "environment"
  | "status"
  | "externalId"
  | "attempt"
  | "url"
  | "details"
> & { providerUpdatedAt: Date };
const positive = z.number().int().positive(),
  timestamp = z.iso.datetime({ offset: true }),
  repo = z.object({ full_name: z.string() });
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success)
    throw new DomainError(
      "VALIDATION",
      "GitHub交付对象格式不符合核验要求",
      null,
    );
  return r.data;
}
function assertRepo(actual: string, expected: string) {
  if (actual.toLowerCase() !== expected.toLowerCase()) throw forbidden();
}
async function readJson(response: Response) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new DomainError(
      "CONFLICT",
      "GitHub对象读取失败，未登记交付证据",
      null,
    );
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 2_097_152) {
        await reader.cancel();
        throw new DomainError("VALIDATION", "GitHub响应过大", null);
      }
      parts.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown;
  } catch {
    throw new DomainError("VALIDATION", "GitHub响应不是有效JSON", null);
  }
}
export async function fetchGitHubDelivery(
  source: DeliverySourceRow,
  integration: DeliveryIntegrationRow,
  event: string,
  payload: unknown,
  deps: DeliveryFetchDeps = {},
): Promise<ProviderEvidence> {
  const p = parse(z.object({ repository: repo }).passthrough(), payload);
  assertRepo(p.repository.full_name, source.repository);
  const root = `${source.apiBaseUrl}/repos/${source.repository}`;
  const read = async (path: string) =>
    readJson(
      await safeOutboundFetch(
        root + path,
        {
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${decryptSecret(integration.tokenEncrypted)}`,
          },
        },
        deps.fetchImpl,
      ),
    );
  const common = {
    repository: source.repository,
    environment: null,
    attempt: 1,
    details: {},
  };
  if (event === "workflow_run") {
    const { workflow_run: r } = parse(
      z.object({ workflow_run: z.object({ id: positive }) }),
      p,
    );
    const run = parse(
      z.object({
        id: positive,
        name: z.string().min(1).max(300),
        workflow_id: positive,
        head_sha: deliverySha,
        run_attempt: positive,
        status: z.string(),
        conclusion: z.string().nullable(),
        updated_at: timestamp,
        html_url: deliveryUrl,
        repository: repo,
      }),
      await read(`/actions/runs/${r.id}`),
    );
    assertRepo(run.repository.full_name, source.repository);
    if (run.id !== r.id) throw forbidden();
    const status: ProviderEvidence["status"] =
      run.status !== "completed"
        ? "PENDING"
        : run.conclusion === "success"
          ? "SUCCEEDED"
          : run.conclusion === "cancelled"
            ? "CANCELLED"
            : "FAILED";
    return {
      ...common,
      kind: "CI",
      title: run.name,
      commitSha: run.head_sha,
      build: run.head_sha,
      status,
      externalId: String(run.id),
      attempt: run.run_attempt,
      providerUpdatedAt: new Date(run.updated_at),
      url: run.html_url,
      details: { workflowId: run.workflow_id, conclusion: run.conclusion },
    };
  }
  if (event === "pull_request") {
    const { number } = parse(z.object({ number: positive }), p);
    const pr = parse(
      z.object({
        number: positive,
        title: z.string().min(1).max(300),
        merged: z.boolean(),
        state: z.enum(["open", "closed"]),
        merge_commit_sha: deliverySha.nullable(),
        head: z.object({ sha: deliverySha }),
        base: z.object({ repo }),
        updated_at: timestamp,
        html_url: deliveryUrl,
      }),
      await read(`/pulls/${number}`),
    );
    assertRepo(pr.base.repo.full_name, source.repository);
    if (pr.number !== number || (pr.merged && !pr.merge_commit_sha))
      throw forbidden();
    const sha = pr.merged ? pr.merge_commit_sha! : pr.head.sha;
    return {
      ...common,
      kind: "PULL_REQUEST",
      title: pr.title,
      commitSha: sha,
      build: sha,
      status: pr.merged
        ? "SUCCEEDED"
        : pr.state === "closed"
          ? "CANCELLED"
          : "PENDING",
      externalId: String(number),
      providerUpdatedAt: new Date(pr.updated_at),
      url: pr.html_url,
      details: { merged: pr.merged, headSha: pr.head.sha },
    };
  }
  if (event === "push") {
    const { after } = parse(z.object({ after: deliverySha }), p);
    if (/^0+$/u.test(after))
      throw new DomainError("VALIDATION", "删除分支不是交付提交", null);
    const commit = parse(
      z.object({
        sha: deliverySha,
        commit: z.object({
          message: z.string(),
          committer: z.object({ date: timestamp }),
        }),
        html_url: deliveryUrl,
      }),
      await read(`/commits/${after}`),
    );
    if (commit.sha !== after) throw forbidden();
    return {
      ...common,
      kind: "COMMIT",
      title: commit.commit.message.split("\n")[0]!.slice(0, 300) || after,
      commitSha: after,
      build: after,
      status: "SUCCEEDED",
      externalId: after,
      providerUpdatedAt: new Date(commit.commit.committer.date),
      url: commit.html_url,
    };
  }
  if (event === "deployment_status") {
    const { deployment: d } = parse(
      z.object({ deployment: z.object({ id: positive }) }),
      p,
    );
    const deployment = parse(
      z.object({
        id: positive,
        sha: deliverySha,
        environment: z.string().min(1).max(300),
      }),
      await read(`/deployments/${d.id}`),
    );
    if (deployment.id !== d.id) throw forbidden();
    const statuses = parse(
      z
        .array(
          z.object({
            id: positive,
            state: z.enum([
              "error",
              "failure",
              "inactive",
              "pending",
              "queued",
              "in_progress",
              "success",
            ]),
            created_at: timestamp,
            updated_at: timestamp,
            environment: z.string().optional(),
            log_url: z.string().optional(),
          }),
        )
        .min(1)
        .max(100),
      await read(`/deployments/${d.id}/statuses?per_page=100`),
    );
    // GitHub按创建时间倒序返回；显式按时间及ID选最新，旧回调不能掩盖随后失败。
    const latest = statuses.sort(
      (a, b) =>
        Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id,
    )[0]!;
    const environment = latest.environment || deployment.environment;
    const status: ProviderEvidence["status"] =
      latest.state === "success"
        ? "SUCCEEDED"
        : ["failure", "error"].includes(latest.state)
          ? "FAILED"
          : latest.state === "inactive"
            ? "CANCELLED"
            : "PENDING";
    const url = latest.log_url
      ? parse(deliveryUrl, latest.log_url)
      : `${source.apiBaseUrl}/repos/${source.repository}/deployments/${d.id}`;
    return {
      ...common,
      kind: "DEPLOYMENT",
      title: `${environment} · ${d.id}`,
      commitSha: deployment.sha,
      build: deployment.sha,
      environment,
      status,
      externalId: String(d.id),
      providerUpdatedAt: new Date(latest.created_at),
      url,
      details: { statusId: latest.id, state: latest.state },
    };
  }
  throw new DomainError("VALIDATION", "不支持的GitHub交付事件", null);
}
