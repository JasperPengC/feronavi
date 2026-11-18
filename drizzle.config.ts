import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  // 迁移文件按可读顺序编号，便于人工审阅
  verbose: true,
  strict: true,
} satisfies Config;
