import { rename, rm, stat } from "node:fs/promises";

export interface BackupPublishOperations {
  stat(path: string): Promise<{ size: number }>;
  rm(path: string, options: { recursive: true; force: true }): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
}

const fileOperations: BackupPublishOperations = { stat, rm, rename };

/** Resolve size and remove private work files before the final rename commit point. */
export async function finalizeStagedPackage(
  stagedPackage: string,
  destination: string,
  workDirectory: string,
  operations: BackupPublishOperations = fileOperations,
): Promise<number> {
  const packageInfo = await operations.stat(stagedPackage);
  await operations.rm(workDirectory, { recursive: true, force: true });
  await operations.rename(stagedPackage, destination);
  return packageInfo.size;
}
