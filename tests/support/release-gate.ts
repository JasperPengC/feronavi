import { runReleaseGateScenario } from "./release-gate-fixture.ts";
import { sql } from "../../src/db/index.ts";
try {
  const r = await runReleaseGateScenario();
  await (
    await import("./release-gate-contracts.ts")
  ).verifyReleaseGateContracts(
    r.actor,
    r.projectId,
    r.releaseId,
    r.workItemId,
    r.sourceId,
    r.testPlanId,
  );
} finally {
  await sql.end({ timeout: 5 });
}
