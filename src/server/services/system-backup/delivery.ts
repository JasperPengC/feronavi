import { sql } from "../../../db/index.ts";
import {
  deliveryUrl,
  deliverySha,
  deliveryRepository,
  deliveryKind,
  deliveryStatus,
} from "../../../shared/schemas/delivery.ts";
/** 历史来源可停用/失效；归属、版本和回执必须保留真实关系。 */
export async function restoredDeliveryIsConsistent(): Promise<boolean> {
  const bad = await sql`
 select 1 from delivery_source s left join integration i on i.id=s.integration_id where
 (s.integration_id is null and (s.enabled or s.webhook_secret_encrypted is not null))
 or (s.integration_id is not null and (i.id is null or i.project_id is distinct from s.project_id or i.kind<>'GITHUB'))
 or (s.enabled and s.webhook_secret_encrypted is null)
 union all
 select 1 from delivery_evidence e left join delivery_source s on s.id=e.source_id where
 (e.source_id is not null and (s.project_id<>e.project_id or e.source_version>s.version))
 or (e.verification='PROVIDER_API' and not exists(select 1 from delivery_receipt r where r.evidence_id=e.id))
 union all
 select 1 from delivery_evidence_link l join delivery_evidence e on e.id=l.evidence_id join work_item w on w.id=l.work_item_id where e.project_id<>w.project_id
 union all
 select 1 from delivery_receipt r join delivery_evidence e on e.id=r.evidence_id where e.source_id is distinct from r.source_id or e.source_version is distinct from r.source_version or e.verification<>'PROVIDER_API'
 limit 1`;
  if (bad.length) return false;
  for await (const rows of sql`select * from delivery_source`.cursor(200))
    for (const s of rows) {
      if (
        !deliveryRepository.safeParse(s.repository).success ||
        !deliveryUrl.safeParse(s.api_base_url).success
      )
        return false;
    }
  for await (const rows of sql`select * from delivery_evidence`.cursor(200))
    for (const e of rows) {
      if (
        !deliveryRepository.safeParse(e.repository).success ||
        !deliverySha.safeParse(e.commit_sha).success ||
        !deliveryUrl.safeParse(e.url).success ||
        !deliveryKind.safeParse(e.kind).success ||
        !deliveryStatus.safeParse(e.status).success ||
        !e.title.trim() ||
        !e.build.trim() ||
        e.title.length > 300 ||
        e.build.length > 200
      )
        return false;
      const details = e.details;
      if (
        !details ||
        typeof details !== "object" ||
        Array.isArray(details) ||
        Object.values(details).some(
          (v) =>
            v !== null && !["string", "boolean", "number"].includes(typeof v),
        )
      )
        return false;
      if (e.verification === "PROVIDER_API") {
        if (e.build !== e.commit_sha) return false;
        if (
          e.kind === "CI" &&
          (!Number.isSafeInteger(details.workflowId) || details.workflowId < 1)
        )
          return false;
        if (
          e.kind === "PULL_REQUEST" &&
          (typeof details.merged !== "boolean" ||
            (e.status === "SUCCEEDED") !== details.merged)
        )
          return false;
        if (
          e.kind === "DEPLOYMENT" &&
          (!e.environment || !Number.isSafeInteger(details.statusId))
        )
          return false;
        if (e.kind === "BUILD") return false;
      }
    }
  for await (const rows of sql`select * from delivery_receipt`.cursor(200))
    for (const r of rows) {
      if (
        !/^[a-f0-9]{64}$/u.test(r.payload_hash) ||
        !["workflow_run", "pull_request", "push", "deployment_status"].includes(
          r.event_type,
        ) ||
        !r.delivery_id ||
        r.delivery_id.length > 200
      )
        return false;
    }
  return true;
}
