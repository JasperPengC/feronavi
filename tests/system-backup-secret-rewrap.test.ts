// @vitest-environment node
import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import * as crypto from "../src/server/services/crypto.service.ts";
import { orderedDatasets } from "../src/server/services/system-backup/registry.ts";

it("显式密钥加密保持enc:v1兼容且不同目标密钥无法解密", () => {
  expect(crypto).toHaveProperty("encryptSecretWithKey", expect.any(Function));
  expect(crypto).toHaveProperty("decryptSecretWithKey", expect.any(Function));
  const source = randomBytes(32),
    target = randomBytes(32);
  const encrypted = crypto.encryptSecretWithKey("迁移SMTP秘密", source);
  expect(encrypted).toMatch(/^enc:v1:/);
  expect(crypto.decryptSecretWithKey(encrypted, source)).toBe("迁移SMTP秘密");
  expect(() => crypto.decryptSecretWithKey(encrypted, target)).toThrow();
  expect(crypto.encryptSecretWithKey(encrypted, source)).toBe(encrypted);
  expect(crypto.decryptSecretWithKey("legacy plaintext", source)).toBe(
    "legacy plaintext",
  );
});

it("仅重封装登记的秘密，原样保留密码、Token和恢复码不可逆哈希", async () => {
  const { rewrapMigratedSecrets } =
    await import("../src/server/services/system-backup/secret-rewrap.ts");
  const source = randomBytes(32),
    target = randomBytes(32);
  const cases = [
    ["setting", "value"],
    ["webhook_endpoint", "secret_encrypted"],
    ["ai_provider_config", "api_key_encrypted"],
    ["two_factor_secret", "secret_encrypted"],
    ["idp_config", "client_secret_encrypted"],
    ["integration", "token_encrypted"],
    ["im_channel", "webhook_url_encrypted"],
    ["im_channel", "app_key_encrypted"],
    ["im_channel", "app_secret_encrypted"],
  ];
  for (const [table, column] of cases) {
    const dataset = orderedDatasets("full").find((d) => d.tableName === table)!;
    const input = {
      [column!]: crypto.encryptSecretWithKey("source secret", source),
      is_secret: true,
    };
    const result = await rewrapMigratedSecrets(input, dataset, source, target);
    expect(crypto.decryptSecretWithKey(String(result[column!]), target)).toBe(
      "source secret",
    );
    expect(() =>
      crypto.decryptSecretWithKey(String(result[column!]), source),
    ).toThrow();
    expect(input[column!]).not.toBe(result[column!]);
  }
  for (const [table, row] of [
    ["member", { password_hash: "$argon2id$opaque" }],
    ["api_token", { token_hash: "irreversible-token-hash" }],
    ["scim_token", { token_hash: "irreversible-scim-hash" }],
    ["two_factor_secret", { recovery_codes_hash: ["recovery-hash"] }],
  ] as const) {
    expect(
      await rewrapMigratedSecrets(
        { ...row },
        orderedDatasets("full").find((d) => d.tableName === table)!,
        source,
        target,
      ),
    ).toEqual(row);
  }
});

it("未知列、JSON嵌套、非秘密setting和不可逆哈希中的源密文全部拒绝", async () => {
  const { rewrapMigratedSecrets } =
    await import("../src/server/services/system-backup/secret-rewrap.ts");
  const source = randomBytes(32),
    target = randomBytes(32);
  const encrypted = crypto.encryptSecretWithKey("unknown secret", source);
  for (const [table, row] of [
    ["integration", { config: { nested: [encrypted] } }],
    ["webhook_delivery", { payload: { password: encrypted } }],
    ["member", { password_hash: encrypted }],
    ["setting", { is_secret: false, value: encrypted }],
    ["setting", { is_secret: true, value: { nested: encrypted } }],
    ["im_channel", { undeclared: encrypted }],
  ] as const) {
    await expect(
      rewrapMigratedSecrets(
        { ...row },
        orderedDatasets("full").find((d) => d.tableName === table)!,
        source,
        target,
      ),
    ).rejects.toMatchObject({ code: "INVALID_BACKUP" });
  }
});

it("safe导入拒绝伪装凭据和全量专属数据，并强制停用AI/IdP/IM", async () => {
  const { prepareImportRow } =
    await import("../src/server/services/system-backup/import-data.ts");
  const dataset = (name: string) =>
    orderedDatasets("full").find((d) => d.tableName === name)!;
  for (const name of [
    "api_token",
    "scim_token",
    "two_factor_secret",
    "mcp_client",
    "mcp_tool_policy",
    "integration",
    "webhook_endpoint",
  ])
    expect(() => prepareImportRow(dataset(name), {}, "safe")).toThrow();
  expect(() =>
    prepareImportRow(
      dataset("setting"),
      { key: "smtp.password", value: "plaintext", is_secret: false },
      "safe",
    ),
  ).toThrow();
  expect(() =>
    prepareImportRow(
      dataset("feature_flag"),
      { config: { nested: "enc:v1:hidden" } },
      "safe",
    ),
  ).toThrow();
  for (const [name, flag] of [
    ["ai_provider_config", "is_active"],
    ["idp_config", "enabled"],
    ["im_channel", "enabled"],
  ]) {
    const row = Object.fromEntries(
      dataset(name!).secretColumns.map((column) => [column, null]),
    );
    expect(
      prepareImportRow(dataset(name!), { ...row, [flag!]: true }, "safe")[
        flag!
      ],
    ).toBe(false);
  }
});

it("safe未携带ai.enabled时也将旧AI端点隔离为disabled说明，避免无密钥请求外部服务", async () => {
  const { prepareImportRow } =
    await import("../src/server/services/system-backup/import-data.ts");
  const setting = orderedDatasets("safe").find(
    (d) => d.tableName === "setting",
  )!;
  for (const key of ["ai.baseUrl", "ai.chatBaseUrl"]) {
    const result = prepareImportRow(
      setting,
      { key, value: "https://provider.test/v1", is_secret: false },
      "safe",
    );
    expect(result.key).toBe(`migration.disabled.${key}`);
    expect(result.value).toEqual({
      enabled: false,
      sourceValue: "https://provider.test/v1",
    });
  }
});

it("业务正文包含enc:v1前缀时仍按普通文本迁移", async () => {
  const { assertSafeMigratedSecrets, rewrapMigratedSecrets } =
    await import("../src/server/services/system-backup/secret-rewrap.ts");
  const dataset = orderedDatasets("safe").find(
    (d) => d.tableName === "comment",
  )!;
  const row = { body: "enc:v1: 这是正文中提到的格式前缀" };
  expect(() => assertSafeMigratedSecrets(row, dataset)).not.toThrow();
  await expect(
    rewrapMigratedSecrets(row, dataset, randomBytes(32), randomBytes(32)),
  ).resolves.toEqual(row);
});

it("带秘密字段的数据集仍允许名称备注中的enc:v1普通文本", async () => {
  const { assertSafeMigratedSecrets, rewrapMigratedSecrets } =
    await import("../src/server/services/system-backup/secret-rewrap.ts");
  for (const [table, column] of [
    ["ai_provider_config", "note"],
    ["im_channel", "name"],
    ["webhook_endpoint", "name"],
  ]) {
    const dataset = orderedDatasets("full").find((d) => d.tableName === table)!;
    const row = { [column!]: "enc:v1: 这是普通管理备注" };
    if (dataset.minimumMode === "safe")
      expect(() => assertSafeMigratedSecrets(row, dataset)).not.toThrow();
    await expect(
      rewrapMigratedSecrets(row, dataset, randomBytes(32), randomBytes(32)),
    ).resolves.toEqual(row);
  }
});

it("IdP配置中的未声明密文在safe和full模式仍被拒绝", async () => {
  const { assertSafeMigratedSecrets, rewrapMigratedSecrets } =
    await import("../src/server/services/system-backup/secret-rewrap.ts");
  const dataset = orderedDatasets("safe").find((d) => d.tableName === "idp_config")!;
  const row = { config: { nested: ["enc:v1:unknown"] } };
  expect(() => assertSafeMigratedSecrets(row, dataset)).toThrow();
  await expect(
    rewrapMigratedSecrets(row, dataset, randomBytes(32), randomBytes(32)),
  ).rejects.toMatchObject({ code: "INVALID_BACKUP" });
});
