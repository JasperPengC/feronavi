import { access, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const requiredFiles = [
  "drizzle/0061_collab_rooms.sql",
  "src/server/routes/collaboration.ts",
  "src/server/services/collab-document.service.ts",
  "src/server/services/collab-room.persistence.ts",
  "src/server/mcp/tools.ts",
  "src/server/mcp/write-tools.ts",
];
for (const file of requiredFiles) await access(file);
const app = await readFile("src/server/app.ts", "utf8");
if (!app.includes("registerCollaborationRoutes")) throw new Error("协作路由未注册");
const mcp = await readFile("src/server/mcp/write-tools.ts", "utf8");
if (!mcp.includes('name: "collab.publishPage"')) throw new Error("MCP 发布工具未注册");

const child = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "tests/collab-business-matrix.test.ts", "tests/collab-room.service.test.ts", "tests/collab-document.service.test.ts", "tests/collab-confirmation.test.ts", "tests/collab-text.test.ts", "tests/mcp-contracts.test.ts", "tests/wiki-ui.test.tsx"], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
