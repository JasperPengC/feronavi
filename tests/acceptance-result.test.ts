import { expect, it } from "vitest";
// @ts-expect-error JavaScript 辅助模块由 Vitest 直接加载
import { classifyAcceptanceExit, acceptanceSuiteKind } from "../scripts/lib/acceptance-result.mjs";

it("区分通过、失败和环境跳过", () => {
  expect(classifyAcceptanceExit(0)).toBe("passed");
  expect(classifyAcceptanceExit(77)).toBe("skipped");
  expect(classifyAcceptanceExit(1)).toBe("failed");
});

it("产品矩阵保留系统迁移，将数据库灾备识别为可选运维", () => {
  expect(acceptanceSuiteKind("accept-system-backup.mjs")).toBe("product");
  expect(acceptanceSuiteKind("accept-ops-db-restore.mjs")).toBe("optional-operations");
  expect(acceptanceSuiteKind("accept-export.mjs")).toBe("product");
});
