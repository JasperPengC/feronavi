import { access, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const requiredFiles = [
  "drizzle/0061_collab_rooms.sql",
  "src/server/routes/collaboration.ts",
  "src/server/services/collab-document.service.ts",
  "src/server/services/collab-events.service.ts",
  "src/client/lib/collab-outbox.ts",
  "src/server/services/collab-room.persistence.ts",
  "src/server/mcp/tools.ts",
  "src/server/mcp/write-tools.ts",
  "src/server/application/capabilities/write-tools.ts",
];
for (const file of requiredFiles) await access(file);
const app = await readFile("src/server/app.ts", "utf8");
if (!app.includes("registerCollaborationRoutes")) throw new Error("协作路由未注册");
const mcp = await readFile("src/server/mcp/write-tools.ts", "utf8");
if (!mcp.includes('../application/capabilities/write-tools.ts')) throw new Error("MCP 写工具未接入应用能力目录");
const capabilities = await readFile("src/server/application/capabilities/write-tools.ts", "utf8");
if (!capabilities.includes('name: "collab.publishPage"')) throw new Error("协作发布能力未注册");
console.log(`CRDT 必需文件 ${requiredFiles.length}/${requiredFiles.length}、协作路由和 MCP 发布能力注册通过`);
if (process.argv.includes("--checks-only")) process.exit(0);

const child = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "tests/collab-business-matrix.test.ts", "tests/collab-room.service.test.ts", "tests/collab-document.service.test.ts", "tests/collab-confirmation.test.ts", "tests/collab-text.test.ts", "tests/collab-outbox.test.ts", "tests/collab-business-events.test.ts", "tests/mcp-contracts.test.ts", "tests/wiki-ui.test.tsx"], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
