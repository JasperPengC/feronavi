import { afterAll, beforeAll, expect, it } from "vitest";
import {
  createIsolatedDatabase,
  prepareDatabase,
  runNode,
  type IsolatedDatabase,
} from "../support/isolated-database.ts";
let database: IsolatedDatabase;
beforeAll(async () => {
  database = await createIsolatedDatabase();
  await prepareDatabase(database);
});
afterAll(async () => {
  await database?.cleanup();
});
it("DB_POOL_MAX=1时独立心跳在保留连接期间续租", async () => {
  const result = await runNode(["tests/integration/job-heartbeat.fixture.ts"], {
    ...database.env,
    DB_POOL_MAX: "1",
  });
  expect(result.stdout).toContain("job heartbeat isolated pool passed");
});
