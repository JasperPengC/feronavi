import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";
import {
  createEncryptionEnvelope,
  encryptPayload,
} from "../../src/server/services/system-backup/crypto.ts";
import { writeOuterArchive } from "../../src/server/services/system-backup/archive.ts";
import { orderedDatasets } from "../../src/server/services/system-backup/registry.ts";

export const fixturePassword = "migration-password-123";

export async function backupFixture(
  root: string,
  options: {
    manifest?: Record<string, unknown>;
    missingManifest?: boolean;
    duplicate?: boolean;
    tamper?: boolean;
    header?: Record<string, unknown>;
    badDataset?: boolean;
    datasetContent?: Buffer;
    mode?: "safe" | "full";
    datasetRows?: Record<string, Record<string, unknown>[]>;
    blobContents?: Buffer[];
    sourceMasterKey?: Buffer;
    omitDatasets?: string[];
  } = {},
) {
  const suffix = randomUUID();
  const inner = join(root, `${suffix}.zip`);
  const payload = join(root, `${suffix}.enc`);
  const outer = join(root, `${suffix}.fnbak`);
  const contents = new Map(
    orderedDatasets(options.mode ?? "safe").map((dataset) => [
      dataset.name,
      Buffer.from(
        (options.datasetRows?.[dataset.name] ?? [])
          .map((row) => JSON.stringify(row) + "\n")
          .join(""),
      ),
    ]),
  );
  const datasets = orderedDatasets(options.mode ?? "safe").filter(dataset => !options.omitDatasets?.includes(dataset.name)).map((dataset) => ({
    name: dataset.name,
    schemaVersion: 1,
    path: `data/${dataset.name}.jsonl`,
    rows: options.datasetRows?.[dataset.name]?.length ?? 0,
    bytes: contents.get(dataset.name)!.length,
    sha256: createHash("sha256")
      .update(contents.get(dataset.name)!)
      .digest("hex"),
    dependsOn: dataset.dependsOn.filter(name => !options.omitDatasets?.includes(name)),
  }));
  if (options.datasetContent)
    Object.assign(datasets[0]!, {
      bytes: options.datasetContent.length,
      rows: 1,
      sha256: createHash("sha256").update(options.datasetContent).digest("hex"),
    });
  const manifest = {
    format: "feronavi-system-backup",
    formatVersion: 1,
    dataSchemaVersion: 1,
    packageId: randomUUID(),
    mode: options.mode ?? "safe",
    createdAt: "2026-11-14T00:00:00.000Z",
    sourceAppVersion: "0.1.0",
    sourceBuild: "test",
    sourceDatabaseRevision: "test",
    requiredFeatures: [],
    capabilities: [],
    datasets,
    blobs: {
      count: options.blobContents?.length ?? 0,
      bytes: (options.blobContents ?? []).reduce(
        (sum, bytes) => sum + bytes.length,
        0,
      ),
      entries: (options.blobContents ?? []).map((bytes) => {
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        return { sha256, bytes: bytes.length, path: `blobs/${sha256}` };
      }),
    },
    excludedData: [],
    encryptionRewrapVersion: 1,
    ...options.manifest,
  };
  const zip = new yazl.ZipFile();
  if (!options.missingManifest)
    zip.addBuffer(Buffer.from(JSON.stringify(manifest)), "manifest.json");
  for (const [index, dataset] of datasets.entries())
    zip.addBuffer(
      index === 0
        ? (options.datasetContent ??
            (options.badDataset
              ? Buffer.from('{"id":"unexpected"}\n')
              : contents.get(dataset.name)!))
        : contents.get(dataset.name)!,
      dataset.path,
    );
  if (options.duplicate) zip.addBuffer(Buffer.alloc(0), datasets[0]!.path);
  for (const bytes of options.blobContents ?? [])
    zip.addBuffer(
      bytes,
      `blobs/${createHash("sha256").update(bytes).digest("hex")}`,
    );
  if (options.mode === "full")
    zip.addBuffer(options.sourceMasterKey ?? Buffer.alloc(32, 7), "secrets/source-master-key.bin");
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(inner, { mode: 0o600 }));
  const { dataKey, keyEnvelope } =
    await createEncryptionEnvelope(fixturePassword);
  try {
    const encryption = await encryptPayload(
      createReadStream(inner),
      createWriteStream(payload, { mode: 0o600 }),
      dataKey,
    );
    let encrypted = await readFile(payload);
    if (options.tamper) {
      encrypted = Buffer.from(encrypted);
      encrypted[0] = encrypted[0]! ^ 1;
    }
    const header = {
      format: "feronavi-system-backup",
      formatVersion: 1,
      createdAt: "2026-11-14T00:00:00.000Z",
      payloadBytes: (await stat(payload)).size,
      payloadSha256: createHash("sha256").update(encrypted).digest("hex"),
      encryption: { ...keyEnvelope, ...encryption },
      ...options.header,
    };
    await writeOuterArchive(
      outer,
      Buffer.from(JSON.stringify(header)),
      encrypted,
    );
    return { path: outer, innerPath: inner, manifest, header };
  } finally {
    dataKey.fill(0);
  }
}
