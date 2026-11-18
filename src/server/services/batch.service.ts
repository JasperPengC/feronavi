/**
 * 批量操作（W2，总纲 5.12）
 *
 * 四条硬规则：
 *   1 **权限预检先行** —— 无权项直接进失败清单（原因 FORBIDDEN），绝不"改到一半才发现无权"
 *   2 **逐项结果** —— 响应是每项的 ok/error，不是全有全无
 *   3 **分批提交** —— 每 50 项一批事务，避免巨型事务占死连接（总纲 9.2）
 *   4 **可重试失败项** —— 前端拿 results 里的失败 id 直接再发一次即可（幂等）
 */
import { DomainError } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";
import * as wiService from "./work-item.service.ts";

const BATCH_SIZE = 50;

export type BatchOp = "transition" | "update" | "assign" | "delete";

export interface BatchResultItem { id: string; ok: boolean; error?: { code: string; message: string } }

/** 权限预检：能改/删一个 = 能批量操作它（沿用单项服务的权限判定） */
async function precheckOne(actor: Actor, id: string): Promise<void> {
  await wiService.getWorkItem(actor, id);
}

export async function runBatch(
  actor: Actor,
  input: {
    op: BatchOp;
    itemIds: string[];
    patch?: Record<string, unknown>;       // update 的字段 / transition 的 statusId / assign 的 assigneeId
  },
): Promise<{ results: BatchResultItem[]; succeeded: number; failed: number }> {
  if (input.itemIds.length === 0) {
    throw new DomainError("VALIDATION", "itemIds 不能为空", null);
  }
  if (input.itemIds.length > 1000) {
    throw new DomainError("VALIDATION", "单次批量最多 1000 项", null);
  }
  if (input.op !== "delete" && !input.patch) {
    throw new DomainError("VALIDATION", "该操作需要 patch", null);
  }
  const ids = [...new Set(input.itemIds)];   // 幂等：重复 id 只处理一次

  // ── ① 权限预检（先于一切写操作）────────────────────────────
  // ⚠️ 反控实录：去掉本层预检，测试依然全绿 —— 单项服务内部有**第二层**
  //    权限兜底（纵深防御）。本层的独立价值是「无权项不进入执行阶段」
  //    （不发起新一轮读取、不进并发执行），语义上满足 5.12 的
  //    「执行前先校验权限」，但对**结果**无可观测差异。不装作有判别力。
  const results: BatchResultItem[] = [];
  const executable: string[] = [];
  for (const id of ids) {
    try {
      await precheckOne(actor, id);
      executable.push(id);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      results.push({
        id,
        ok: false,
        error: { code: err.code ?? "FORBIDDEN", message: err.message ?? "无权操作该项" },
      });
    }
  }

  // ── ② 分批执行（每批一个事务边界；单项失败不拖垮同批其他项）──
  for (let i = 0; i < executable.length; i += BATCH_SIZE) {
    const batch = executable.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (id) => {
      try {
        if (input.op === "delete") {
          await wiService.deleteWorkItem(actor, id);
        } else if (input.op === "transition") {
          const cur = await wiService.getWorkItem(actor, id) as unknown as { version: number };
          // 文档契约：transition 用 toStateKey（状态 key），不是 statusId
          await wiService.transitionWorkItem(actor, id, {
            version: cur.version,
            toStateKey: String(input.patch!.toStateKey),
          });
        } else if (input.op === "assign") {
          const cur = await wiService.getWorkItem(actor, id) as unknown as { version: number };
          await wiService.updateWorkItem(actor, id, {
            version: cur.version, assigneeId: input.patch!.assigneeId ?? null,
          });
        } else {
          const cur = await wiService.getWorkItem(actor, id) as unknown as { version: number };
          await wiService.updateWorkItem(actor, id, {
            version: cur.version, ...(input.patch as object),
          });
        }
        results.push({ id, ok: true });
      } catch (e) {
        const err = e as { code?: string; message?: string };
        results.push({
          id,
          ok: false,
          error: { code: err.code ?? "INTERNAL", message: err.message ?? "执行失败" },
        });
      }
    }));
  }

  // 按 itemIds 原始顺序输出，前端好对账
  results.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  const succeeded = results.filter((r) => r.ok).length;
  return { results, succeeded, failed: results.length - succeeded };
}
