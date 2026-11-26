import { describe, expect, it } from "vitest";
import {
  classifyDatabaseTable,
  datasetRegistry,
  orderedDatasets,
} from "../src/server/services/system-backup/registry.ts";

describe("system backup dataset registry", () => {
  it("returns every migratable dataset once in dependency order", () => {
    const registryNames = datasetRegistry.map((dataset) => dataset.name);
    expect(new Set(registryNames).size).toBe(registryNames.length);

    const ordered = orderedDatasets("safe");
    const names = ordered.map((dataset) => dataset.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("identity.member");
    expect(names.indexOf("identity.department")).toBeLessThan(
      names.indexOf("identity.member"),
    );
    expect(names.indexOf("projects.project")).toBeLessThan(
      names.indexOf("projects.work_item"),
    );
  });

  it("does not include full-only datasets in safe mode", () => {
    expect(
      orderedDatasets("safe").some((dataset) => dataset.minimumMode === "full"),
    ).toBe(false);
    expect(
      orderedDatasets("full").some((dataset) => dataset.minimumMode === "full"),
    ).toBe(true);
  });

  it("projects only declared columns and separates migration credentials from compliance data", () => {
    const member = datasetRegistry.find(
      (dataset) => dataset.tableName === "member",
    )!;
    const row = {
      id: "m-1",
      username: "admin",
      password_hash: "$argon2id$hash",
      created_at: new Date("2026-01-02T03:04:05.000Z"),
      undeclared_secret: "never-export",
    };

    expect(
      member.encodeRow(row, { mode: "safe", purpose: "migration" }),
    ).toMatchObject({
      id: "m-1",
      password_hash: "$argon2id$hash",
      created_at: "2026-01-02T03:04:05.000Z",
    });
    expect(
      member.encodeRow(row, { mode: "safe", purpose: "compliance" }),
    ).not.toHaveProperty("password_hash");
    expect(
      member.encodeRow(row, { mode: "safe", purpose: "compliance" }),
    ).not.toHaveProperty("undeclared_secret");
  });

  it("filters secret settings and sanitizes provider and identity secrets in safe mode", () => {
    const setting = datasetRegistry.find(
      (dataset) => dataset.tableName === "setting",
    )!;
    const provider = datasetRegistry.find(
      (dataset) => dataset.tableName === "ai_provider_config",
    )!;
    const idp = datasetRegistry.find(
      (dataset) => dataset.tableName === "idp_config",
    )!;
    expect(
      setting.encodeRow(
        { key: "public", value: "ok", is_secret: false },
        { mode: "safe", purpose: "migration" },
      ),
    ).toMatchObject({ value: "ok" });
    expect(
      setting.encodeRow(
        { key: "private", value: "secret", is_secret: true },
        { mode: "safe", purpose: "migration" },
      ),
    ).toBeNull();
    expect(
      provider.encodeRow(
        { id: "p", api_key_encrypted: "cipher", is_active: true },
        { mode: "safe", purpose: "migration" },
      ),
    ).toMatchObject({ api_key_encrypted: null, is_active: false });
    expect(
      idp.encodeRow(
        { id: "i", client_secret_encrypted: "cipher", enabled: true },
        { mode: "safe", purpose: "migration" },
      ),
    ).toMatchObject({ client_secret_encrypted: null, enabled: false });
  });

  it("disables reusable intake bearer tokens only in safe migration projection", () => {
    const intakeForm = datasetRegistry.find(
      (dataset) => dataset.tableName === "intake_form",
    )!;
    const row = {
      id: "form-1",
      name: "Public intake",
      is_active: true,
      submit_token_hash: "a".repeat(64),
    };

    expect(
      intakeForm.encodeRow(row, { mode: "safe", purpose: "migration" }),
    ).toMatchObject({
      id: "form-1",
      is_active: false,
      submit_token_hash: "disabled-migration:form-1",
    });
    expect(
      intakeForm.encodeRow(row, { mode: "full", purpose: "migration" }),
    ).toMatchObject({
      is_active: true,
      submit_token_hash: "a".repeat(64),
    });
    expect(
      intakeForm.encodeRow(row, { mode: "safe", purpose: "compliance" }),
    ).not.toHaveProperty("submit_token_hash");
  });

  it("decodes only declared timestamp columns and parses them to Date values", async () => {
    const member = datasetRegistry.find(
      (dataset) => dataset.tableName === "member",
    )!;
    const row = await member.decodeRow(
      {
        id: "m-1",
        last_login_at: "2026-01-02T03:04:05.000Z",
        username: "2026-01-02T03:04:05.000Z",
      },
      { mode: "safe", phase: "backfill" },
    );
    expect(row.last_login_at).toEqual(new Date("2026-01-02T03:04:05.000Z"));
    expect(row.username).toBe("2026-01-02T03:04:05.000Z");
  });

  it("classifies known non-migration tables and leaves unknown tables visible", () => {
    expect(classifyDatabaseTable("page_chunk")).toBe("rebuild");
    expect(classifyDatabaseTable("session")).toBe("exclude");
    expect(classifyDatabaseTable("system_backup")).toBe("control");
    expect(classifyDatabaseTable("unregistered_future_table")).toBeUndefined();
  });

  it("clears self and cyclic foreign keys for insert then restores them in backfill", async () => {
    const page = datasetRegistry.find(
      (dataset) => dataset.tableName === "page",
    )!;
    const department = datasetRegistry.find(
      (dataset) => dataset.tableName === "department",
    )!;
    const source = { id: "page-1", current_revision_id: "revision-1" };

    expect(page.deferredReferenceColumns).toEqual([
      {
        column: "created_by",
        targetDataset: "identity.member",
        targetColumn: "id",
      },
      {
        column: "current_revision_id",
        targetDataset: "content.page_revision",
        targetColumn: "id",
      },
    ]);
    expect(
      await page.decodeRow(source, { mode: "safe", phase: "insert" }),
    ).toEqual({ id: "page-1", current_revision_id: null });
    expect(
      await page.decodeRow(source, { mode: "safe", phase: "backfill" }),
    ).toEqual(source);
    expect(
      await department.decodeRow(
        { id: "d-1", parent_id: "d-0" },
        { mode: "safe", phase: "insert" },
      ),
    ).toEqual({ id: "d-1", parent_id: null });
    expect(
      await department.decodeRow(
        { id: "d-1", parent_id: "d-0" },
        { mode: "safe", phase: "backfill" },
      ),
    ).toEqual({ id: "d-1", parent_id: "d-0" });
  });

  it("defers every schema self-reference and keeps full-only credentials out of safe exports", () => {
    const selfReferences = datasetRegistry
      .flatMap((dataset) =>
        dataset.selfReferenceColumns.map(
          (column) => `${dataset.tableName}.${column}`,
        ),
      )
      .sort();
    expect(selfReferences).toEqual([
      "comment.parent_id",
      "department.parent_id",
      "module.parent_id",
      "page.parent_id",
      "team.parent_id",
      "work_item.parent_id",
    ]);

    const token = datasetRegistry.find(
      (dataset) => dataset.tableName === "api_token",
    )!;
    expect(token.minimumMode).toBe("full");
    expect(
      token.encodeRow(
        { id: "t-1", token_hash: "secret" },
        { mode: "safe", purpose: "migration" },
      ),
    ).toBeNull();
    expect(
      token.encodeRow(
        { id: "t-1", token_hash: "secret" },
        { mode: "full", purpose: "migration" },
      ),
    ).toMatchObject({ token_hash: "secret" });
    expect(
      token.encodeRow(
        { id: "t-1", token_hash: "secret" },
        { mode: "full", purpose: "compliance" },
      ),
    ).not.toHaveProperty("token_hash");
  });
});

it("持久知识会话与消息完整纳入备份，消息在所属会话之后恢复", () => {
  const names = orderedDatasets("safe").map(dataset => dataset.name);
  expect(names).toContain("operations.rag_conversation");
  expect(names).toContain("operations.rag_message");
  expect(names.indexOf("identity.member")).toBeLessThan(names.indexOf("operations.rag_conversation"));
  expect(names.indexOf("projects.project")).toBeLessThan(names.indexOf("operations.rag_conversation"));
  expect(names.indexOf("operations.rag_conversation")).toBeLessThan(names.indexOf("operations.rag_message"));
  const messages = datasetRegistry.find(dataset => dataset.tableName === "rag_message")!;
  expect(messages.columns).toContain("reply");
  expect(messages.encodeRow({ id: "m", conversation_id: "c", request_id: "r", question: "问", status: "completed", reply: { answer: "答" }, undeclared_secret: "drop" }, { mode: "safe", purpose: "migration" })).not.toHaveProperty("undeclared_secret");
});
