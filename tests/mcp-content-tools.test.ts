// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { ToolDef } from "../src/server/mcp/tools.ts";

vi.mock("../src/db/index.ts", () => ({ db: {}, sql: {} }));
import { ALL_TOOLS as CONTENT_TOOLS } from "../src/server/application/capabilities/tools.ts";
const required = [
  "sla.listPolicies",
  "sla.createPolicy",
  "sla.updatePolicy",
  "sla.deletePolicy",
  "idea.list",
  "idea.get",
  "idea.update",
  "idea.unvote",
  "idea.delete",
  "page.revisions",
  "page.restore",
  "page.delete",
  "page.permissions",
  "page.setPermissions",
  "attachment.download",
  "attachment.remove",
  "automation.updateRule",
  "automation.deleteRule",
  "automation.testRule",
  "notification.getPrefs",
  "announcement.list",
  "intake.listForms",
  "intake.getForm",
  "intake.createForm",
  "intake.updateForm",
  "intake.deleteForm",
  "intake.listSubmissions",
  "intake.convertSubmission",
  "intake.rejectSubmission",
];
const validator = new AjvJsonSchemaValidator();
function valid(name: string, args: Record<string, unknown>) {
  const tool = CONTENT_TOOLS.find((t: ToolDef) => t.name === name);
  expect(tool, name).toBeDefined();
  return validator.getValidator(tool!.inputSchema)({ ...args, ...(tool!.kind === "write" ? { userConfirmed: true } : {}) }).valid;
}
const id = "11111111-1111-4111-8111-111111111111";

describe("内容和自动化 MCP 契约", () => {
  it("注册完整的业务发现、读写和删除入口", () => {
    expect(CONTENT_TOOLS.map((t: ToolDef) => t.name)).toEqual(
      expect.arrayContaining(required),
    );
    expect(new Set(CONTENT_TOOLS.map((t: ToolDef) => t.name)).size).toBe(
      CONTENT_TOOLS.length,
    );
  });
  it("拒绝数字字符串、非法枚举和嵌套未知字段", () => {
    expect(valid("idea.list", { projectId: id, page: "2" })).toBe(false);
    expect(valid("idea.list", { projectId: id, page: 1.5 })).toBe(false);
    expect(valid("idea.update", { ideaId: id, status: "UNKNOWN" })).toBe(false);
    expect(
      valid("intake.listSubmissions", { projectId: id, status: "UNKNOWN" }),
    ).toBe(false);
    expect(
      valid("intake.createForm", {
        projectId: id,
        name: "form",
        schema: [{ key: "title", label: "标题", hidden: true }],
      }),
    ).toBe(false);
    expect(
      valid("page.setPermissions", {
        projectId: id,
        pageId: id,
        permissions: [
          {
            principalType: "MEMBER",
            principalId: id,
            canRead: true,
            canWrite: "yes",
          },
        ],
      }),
    ).toBe(false);
    expect(
      valid("automation.updateRule", {
        projectId: id,
        ruleId: id,
        conditions: { all: 123 },
      }),
    ).toBe(false);
    expect(
      valid("automation.updateRule", {
        projectId: id,
        ruleId: id,
        actions: [{ type: "CALL_WEBHOOK", hidden: true }],
      }),
    ).toBe(false);
  });
  it("每个工具拒绝未知顶层字段", () => {
    for (const tool of CONTENT_TOOLS)
      expect(
        validator.getValidator(tool.inputSchema)({ hidden: true }).valid,
        tool.name,
      ).toBe(false);
  });
  it("允许合法表单、权限、自动化输入", () => {
    expect(
      valid("intake.createForm", {
        projectId: id,
        name: "form",
        schema: [{ key: "title", label: "标题", type: "TEXT", required: true }],

      }),
    ).toBe(true);
    expect(
      valid("automation.updateRule", {
        projectId: id,
        ruleId: id,
        enabled: false,
      }),
    ).toBe(true);
    expect(
      valid("page.setPermissions", {
        projectId: id,
        pageId: id,
        permissions: [
          {
            principalType: "MEMBER",
            principalId: id,
            canRead: true,
            canWrite: false,
          },
        ],
      }),
    ).toBe(true);
  });
});

it("附件读取在边界内成功，越界时拒绝，且不依赖元数据大小", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { readStoredAttachment } =
    await import("../src/server/services/attachment.service.ts");
  const directory = await mkdtemp(join(tmpdir(), "mcp-attachment-bound-"));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = directory;
  try {
    const relative =
      "restored/11111111-1111-4111-8111-111111111111/" + "a".repeat(64);
    await mkdir(
      join(
        directory,
        "attachments",
        "restored",
        "11111111-1111-4111-8111-111111111111",
      ),
      { recursive: true },
    );
    await writeFile(
      join(directory, "attachments", relative),
      Buffer.from("12345"),
    );
    expect((await readStoredAttachment(relative, "local", 5)).toString()).toBe(
      "12345",
    );
    await expect(
      readStoredAttachment(relative, "local", 4),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

it("S3 下载越界后停止消费对象流", async () => {
  const { Readable } = await import("node:stream");
  const { S3Client } = await import("@aws-sdk/client-s3");
  const storage = await import("../src/server/services/storage.service.ts");
  const { readStoredAttachment } =
    await import("../src/server/services/attachment.service.ts");
  let consumed = 0;
  const stream = Readable.from(
    (async function* () {
      for (let i = 0; i < 100; i++) {
        consumed++;
        yield Buffer.from("12345");
        await new Promise((resolve) => setImmediate(resolve));
      }
    })(),
  );
  const configuration = vi
    .spyOn(storage, "loadStorageConfig")
    .mockResolvedValue({
      kind: "s3",
      endpoint: "https://storage.example.test",
      region: "test",
      bucket: "test",
      accessKey: "fixture",
      secretKey: "fixture",
      forcePathStyle: true,
      prefix: "",
    });
  const send = vi
    .spyOn(S3Client.prototype, "send")
    .mockImplementation(async () => ({ Body: stream }) as never);
  try {
    await expect(
      readStoredAttachment("bounded-object", "s3", 5),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(stream.destroyed).toBe(true);
    expect(consumed).toBeLessThan(100);
  } finally {
    send.mockRestore();
    configuration.mockRestore();
    stream.destroy();
  }
});

it("SLA 策略拒绝非整数时限、非法枚举和未知日历字段", () => {
  expect(
    valid("sla.createPolicy", {
      projectId: id,
      name: "策略",
      responseMinutes: "30",
      resolveMinutes: 60,
    }),
  ).toBe(false);
  expect(
    valid("sla.createPolicy", {
      projectId: id,
      name: "策略",
      responseMinutes: 1.5,
      resolveMinutes: 60,
    }),
  ).toBe(false);
  expect(
    valid("sla.createPolicy", {
      projectId: id,
      name: "策略",
      responseMinutes: 30,
      resolveMinutes: 60,
      priority: "UNKNOWN",
    }),
  ).toBe(false);
  expect(
    valid("sla.updatePolicy", {
      projectId: id,
      policyId: id,
      calendar: { days: [7] },
    }),
  ).toBe(false);
  expect(
    valid("sla.updatePolicy", {
      projectId: id,
      policyId: id,
      calendar: { hidden: true },
    }),
  ).toBe(false);
  expect(
    valid("sla.createPolicy", {
      projectId: id,
      name: "策略",
      responseMinutes: 30,
      resolveMinutes: 60,
      calendar: {
        enabled: true,
        days: [1, 2, 3, 4, 5],
        start: "09:00",
        end: "18:00",
      },
    }),
  ).toBe(true);
});
