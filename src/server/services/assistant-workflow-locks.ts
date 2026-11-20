import type { RagActionProposal } from "../../shared/rag.ts";
import { DomainError } from "../../shared/errors.ts";
import { ASSISTANT_WORKFLOW_CONTRACTS } from "./assistant-workflow-contracts.ts";
export async function lockAssistantWorkflowRecords(action: RagActionProposal) {
  const contract = ASSISTANT_WORKFLOW_CONTRACTS[action.toolName];
  if (!contract) return;
  const { db } = await import("../../db/index.ts");
  const { sql } = await import("drizzle-orm");
  for (const lock of contract.locks(action.parameters, action.projectId)) {
    // 标识符只来自静态契约函数，模型值只可绑定为UUID。
    if (
      !/^[a-z_]+$/.test(lock.table) ||
      !/^[a-z_]+$/.test(lock.column) ||
      lock.ids.some((id) => !/^[a-f0-9-]{36}$/i.test(id))
    )
      throw new DomainError("INTERNAL", "流程锁契约无效", null);
    if (lock.ids.length)
      await db.execute(
        sql`select 1 from ${sql.identifier(lock.table)} where ${sql.identifier(lock.column)} in (${sql.join(
          lock.ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}) order by ${sql.identifier(lock.column)} for update`,
      );
  }
}
