export const classifyAcceptanceExit = (code) => code === 0 ? "passed" : code === 77 ? "skipped" : "failed";

/** 数据库灾备属于部署运维，默认产品矩阵不运行；可用 --only 显式选择。 */
export const acceptanceSuiteKind = (name) => name === "accept-ops-db-restore.mjs" ? "optional-operations" : "product";
