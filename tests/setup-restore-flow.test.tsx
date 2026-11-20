import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { setLocale } from "../src/client/i18n/index.ts";
import { SetupRestoreFlow } from "../src/client/components/setup/SetupRestoreFlow.tsx";
import { SetupPage } from "../src/client/routes/SetupPage.tsx";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  Link: ({
    to,
    children,
    className,
  }: {
    to: string;
    children: unknown;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  setLocale("zh-CN");
  navigate.mockReset();
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const restoreId = "11111111-1111-4111-8111-111111111111";
const report = {
  id: restoreId,
  status: "PREFLIGHT_PASSED",
  mode: "safe",
  sourceVersion: "0.9.0",
  manifestSummary: {
    createdAt: "2026-11-14T00:00:00.000Z",
    datasetCount: 4,
    totalRows: 12345,
    blobCount: 2,
    blobBytes: 4096,
    excludedData: ["sessions"],
    warnings: [],
  },
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
function chooseBackup(
  password = "a-secure-migration-password",
  name = "restore.fnbak",
) {
  fireEvent.change(screen.getByLabelText(/选择系统备份|Choose system backup/), {
    target: { files: [new File(["backup"], name)] },
  });
  fireEvent.change(screen.getByLabelText(/迁移密码|Migration password/), {
    target: { value: password },
  });
  fireEvent.click(
    screen.getByRole("button", { name: /上传并检查|Upload and check/ }),
  );
}
async function confirmBackup() {
  await screen.findByLabelText(/确认短语|Confirmation phrase/);
  fireEvent.change(screen.getByLabelText(/确认短语|Confirmation phrase/), {
    target: { value: "恢复此实例" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: /开始恢复|Start restore/ }),
  );
}

describe("恢复审查回归", () => {
  it("预检成功后重新选文件清理失败，继续成功恢复不再展示旧清理错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "DELETE")
          return json({ code: "INTERNAL", message: "旧文件清理暂时失败" }, 500);
        if (url.endsWith("/preflight")) return json(report);
        if (url.endsWith("/status"))
          return json({ ...report, status: "SUCCEEDED" });
        return json({ id: restoreId });
      }),
    );
    render(<SetupRestoreFlow onBack={vi.fn()} />);
    chooseBackup();
    await screen.findByLabelText("确认短语");
    fireEvent.click(screen.getByRole("button", { name: "重新选择文件" }));
    await screen.findByText("旧文件清理暂时失败");
    await confirmBackup();
    await screen.findByText("业务恢复成功");
    expect(screen.queryByText("旧文件清理暂时失败")).toBeNull();
  });

  it("英文预检显示固定中文短语及本地化日期数值", async () => {
    setLocale("en-US");
    const request = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        if (String(input).endsWith("/preflight")) return json(report);
        if (String(input).endsWith("/status"))
          return json({ ...report, status: "SUCCEEDED" });
        return json({ id: restoreId });
      },
    );
    vi.stubGlobal("fetch", request);
    render(<SetupRestoreFlow onBack={vi.fn()} />);
    chooseBackup();
    await screen.findByLabelText("Confirmation phrase");
    expect(screen.getByText(/Enter.*恢复此实例/)).toBeTruthy();
    expect(
      screen.getByText(
        new Date(report.manifestSummary.createdAt).toLocaleString("en-US"),
      ),
    ).toBeTruthy();
    expect(screen.getByText("12,345")).toBeTruthy();
    await confirmBackup();
    await screen.findByText("Business restore succeeded");
    const confirmation = request.mock.calls.find(([input]) =>
      String(input).endsWith("/confirm"),
    );
    expect(JSON.parse(String(confirmation?.[1]?.body))).toEqual({
      migrationPassword: "a-secure-migration-password",
      confirmation: "恢复此实例",
    });
  });

  it("预检与首次删除失败后保留ID，重新开始先清理同ID，再换文件密码上传", async () => {
    const deletes: string[] = [];
    const uploaded: string[] = [];
    const passwords: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "DELETE") {
          deletes.push(url);
          return deletes.length === 1
            ? json({ code: "INTERNAL", message: "旧上传暂时无法删除" }, 500)
            : json({ ok: true });
        }
        if (url.endsWith("/upload")) {
          uploaded.push(((init?.body as FormData).get("file") as File).name);
          return json({ id: restoreId });
        }
        if (url.endsWith("/preflight")) {
          passwords.push(JSON.parse(String(init?.body)).migrationPassword);
          return passwords.length === 1
            ? json({ code: "INVALID_BACKUP", message: "密码或备份无效" }, 400)
            : json(report);
        }
        return json({});
      }),
    );
    render(<SetupRestoreFlow onBack={vi.fn()} />);
    chooseBackup();
    await screen.findByText("密码或备份无效");
    expect(screen.getByText("旧上传暂时无法删除")).toBeTruthy();
    expect(screen.queryByLabelText("迁移密码")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新开始" }));
    await screen.findByLabelText("迁移密码");
    expect(deletes).toEqual([
      expect.stringContaining(restoreId),
      expect.stringContaining(restoreId),
    ]);
    expect(screen.getByLabelText("迁移密码")).toHaveProperty("value", "");
    expect(screen.getByRole("button", { name: "上传并检查" })).toHaveProperty(
      "disabled",
      true,
    );
    chooseBackup("another-secure-password", "replacement.fnbak");
    await screen.findByLabelText("确认短语");
    expect(uploaded).toEqual(["restore.fnbak", "replacement.fnbak"]);
    expect(passwords).toEqual([
      "a-secure-migration-password",
      "another-secure-password",
    ]);
  });

  it("确认响应丢失后读取真实状态，不误删恢复；重建失败引导管理员系统页重试", async () => {
    const deletes: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "DELETE") deletes.push(url);
        if (url.endsWith("/preflight")) return json(report);
        if (url.endsWith("/confirm")) throw new TypeError("network lost");
        if (url.endsWith("/status"))
          return json({
            ...report,
            status: "SUCCEEDED",
            rebuild: {
              status: "FAILED",
              message: "索引重建失败",
              canRetry: true,
            },
          });
        return json({ id: restoreId });
      }),
    );
    render(<SetupRestoreFlow onBack={vi.fn()} />);
    chooseBackup();
    await confirmBackup();
    await screen.findByText("业务恢复成功");
    expect(deletes).toEqual([]);
    expect(screen.getByText(/管理员.*系统.*重试/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "前往登录" }).getAttribute("href"),
    ).toBe("/login");
  });

  it("确认请求未抵达且状态仍为预检完成时允许重新输入密码幂等确认", async () => {
    let confirms = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/preflight")) return json(report);
        if (url.endsWith("/confirm")) {
          confirms++;
          if (confirms === 1) throw new TypeError("network lost");
          return json({ ...report, status: "RESTORING" });
        }
        if (url.endsWith("/status"))
          return json({ ...report, status: "PREFLIGHT_PASSED" });
        return json({ id: restoreId });
      }),
    );
    render(<SetupRestoreFlow onBack={vi.fn()} />);
    chooseBackup();
    await confirmBackup();
    await screen.findByLabelText("重新输入迁移密码");
    fireEvent.change(screen.getByLabelText("重新输入迁移密码"), {
      target: { value: "retry-migration-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "重新确认恢复" }));
    await waitFor(() => expect(confirms).toBe(2));
  });

  it("12–256字符以外密码不能发起上传", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SetupRestoreFlow onBack={vi.fn()} />);
    chooseBackup("x".repeat(257));
    expect(screen.getByRole("button", { name: "上传并检查" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("服务端明确恢复失败后清理旧上传，再使用新文件与密码恢复", async () => {
    const uploads: string[] = [];
    const passwords: string[] = [];
    const deleted: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "DELETE") {
          deleted.push(url);
          return json({ ok: true });
        }
        if (url.endsWith("/upload")) {
          uploads.push(((init?.body as FormData).get("file") as File).name);
          return json({ id: restoreId });
        }
        if (url.endsWith("/preflight")) {
          passwords.push(JSON.parse(String(init?.body)).migrationPassword);
          return json(report);
        }
        if (url.endsWith("/status"))
          return json({
            ...report,
            status: "FAILED",
            lastError: "业务恢复失败，未提交业务数据",
          });
        return json({ id: restoreId });
      }),
    );
    render(<SetupRestoreFlow onBack={vi.fn()} />);
    chooseBackup();
    await confirmBackup();
    await screen.findByText("业务恢复失败，未提交业务数据");
    expect(deleted).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "重新开始" }));
    await screen.findByLabelText("迁移密码");
    expect(screen.getByLabelText("选择系统备份")).toHaveProperty("value", "");
    expect(screen.getByLabelText("迁移密码")).toHaveProperty("value", "");
    chooseBackup("replacement-password", "replacement.fnbak");
    await screen.findByLabelText("确认短语");
    expect(deleted).toEqual([expect.stringContaining(restoreId)]);
    expect(uploads).toEqual(["restore.fnbak", "replacement.fnbak"]);
    expect(passwords).toEqual([
      "a-secure-migration-password",
      "replacement-password",
    ]);
  });

  it("确认与状态响应暂时失败时继续核实，成功后清错误并停止轮询", async () => {
    const callbacks: (() => Promise<void>)[] = [];
    const nativeTimeout = window.setTimeout.bind(window);
    const timers = vi.spyOn(window, "setTimeout").mockImplementation(((
      callback: TimerHandler,
      delay?: number,
    ) => {
      if (delay === 15_000) {
        callbacks.push(callback as () => Promise<void>);
        return 456;
      }
      return nativeTimeout(callback, delay);
    }) as typeof window.setTimeout);
    let reads = 0;
    const request = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/preflight")) return json(report);
        if (url.endsWith("/confirm")) throw new TypeError("response lost");
        if (url.endsWith("/status")) {
          reads += 1;
          if (reads === 1)
            return json({ code: "INTERNAL", message: "状态暂不可用" }, 503);
          return json({
            ...report,
            status:
              reads === 2
                ? "PREFLIGHT_PASSED"
                : reads === 3
                  ? "RESTORING"
                  : "SUCCEEDED",
          });
        }
        return json({ id: restoreId });
      },
    );
    vi.stubGlobal("fetch", request);
    const view = render(<SetupRestoreFlow onBack={vi.fn()} />);
    chooseBackup();
    await confirmBackup();
    await screen.findByText("状态暂不可用");
    expect(screen.queryByRole("button", { name: "重新开始" })).toBeNull();
    expect(screen.queryByRole("button", { name: "返回方式选择" })).toBeNull();
    await act(async () => {
      callbacks[0]();
    });
    await waitFor(() => expect(reads).toBe(2));
    expect(screen.queryByText("状态暂不可用")).toBeNull();
    await act(async () => {
      callbacks[1]();
    });
    await waitFor(() => expect(reads).toBe(3));
    await act(async () => {
      callbacks[2]();
    });
    await screen.findByText("业务恢复成功");
    expect(reads).toBe(4);
    expect(callbacks).toHaveLength(3);
    expect(
      request.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
    view.unmount();
    timers.mockRestore();
  });

  it("卸载时取消恢复轮询且卸载后的回调不再请求", async () => {
    let callback: (() => void) | undefined;
    const nativeTimeout = window.setTimeout.bind(window);
    vi.spyOn(window, "setTimeout").mockImplementation(((
      fn: TimerHandler,
      delay?: number,
    ) => {
      if (delay === 15_000) {
        callback = fn as () => void;
        return 789;
      }
      return nativeTimeout(fn, delay);
    }) as typeof window.setTimeout);
    const clear = vi.spyOn(window, "clearTimeout");
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/preflight")) return json(report);
        if (url.endsWith("/status")) {
          reads += 1;
          return json({ ...report, status: "RESTORING" });
        }
        return json({ id: restoreId });
      }),
    );
    const view = render(<SetupRestoreFlow onBack={vi.fn()} />);
    chooseBackup();
    await confirmBackup();
    await waitFor(() => expect(callback).toBeTypeOf("function"));
    view.unmount();
    expect(clear).toHaveBeenCalledWith(789);
    await act(async () => {
      callback?.();
    });
    expect(reads).toBe(1);
  });

  it("创建新系统保留原六步并完成安装", async () => {
    let completed: {
      admin: Record<string, unknown>;
      org: Record<string, unknown>;
    } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/precheck"))
          return json({
            items: [{ key: "db", ok: true, message: "数据库连通" }],
          });
        if (url.endsWith("/database"))
          return json({ ok: true, compatible: true });
        if (url.endsWith("/complete"))
          completed = JSON.parse(String(init?.body));
        return json({});
      }),
    );
    render(<SetupPage />);
    fireEvent.click(await screen.findByRole("radio", { name: /创建新系统/ }));
    expect(screen.getByRole("heading", { name: "2. 数据库" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    for (const [label, value] of [
      ["用户名", "admin"],
      ["姓名", "Admin"],
      ["邮箱", "admin@example.com"],
      ["密码", "secure-admin-password"],
      ["确认密码", "secure-admin-password"],
    ]) {
      fireEvent.change(screen.getByLabelText(label, { exact: true }), {
        target: { value },
      });
    }
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.change(screen.getByLabelText("组织名称"), {
      target: { value: "Test organisation" },
    });
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByRole("heading", { name: "5. 可选集成" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "完成安装" }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: "/login" }),
    );
    expect(completed).toMatchObject({
      admin: { username: "admin" },
      org: { name: "Test organisation" },
    });
  });
});

describe("安装向导恢复流程", () => {
  it("环境检查通过后展示创建与恢复两个互斥入口", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/precheck"))
          return new Response(
            JSON.stringify({
              items: [{ key: "database", ok: true, message: "数据库连通" }],
            }),
            { status: 200 },
          );
        return new Response(JSON.stringify({}), { status: 404 });
      }),
    );
    render(<SetupPage />);
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /创建新系统/ })).toBeTruthy(),
    );
    expect(screen.getByRole("radio", { name: /从系统备份恢复/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /从系统备份恢复/ }));
    expect(
      screen.getByRole("heading", { name: "从系统备份恢复" }),
    ).toBeTruthy();
  });

  it("上传前 bootstrap，预检展示真实摘要并要求固定确认短语", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/bootstrap"))
          return new Response(JSON.stringify({ csrfToken: "csrf" }), {
            status: 200,
          });
        if (url.endsWith("/upload"))
          return new Response(
            JSON.stringify({
              id: "11111111-1111-4111-8111-111111111111",
              status: "UPLOADED",
            }),
            { status: 200 },
          );
        if (url.endsWith("/preflight"))
          return new Response(
            JSON.stringify({
              id: "11111111-1111-4111-8111-111111111111",
              packageId: "22222222-2222-4222-8222-222222222222",
              status: "PREFLIGHT_PASSED",
              mode: "safe",
              sourceVersion: "0.9.0",
              manifestSummary: {
                datasetCount: 4,
                totalRows: 18,
                blobCount: 2,
                blobBytes: 4096,
                excludedData: ["sessions"],
                warnings: ["需要重新配置密钥"],
              },
              lastError: null,
              createdAt: "2026-11-14T00:00:00.000Z",
              updatedAt: "2026-11-14T00:00:00.000Z",
              completedAt: null,
            }),
            { status: 200 },
          );
        return new Response(JSON.stringify({}), { status: 404 });
      }),
    );

    render(<SetupRestoreFlow onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("选择系统备份"), {
      target: { files: [new File(["backup"], "restore.fnbak")] },
    });
    fireEvent.change(screen.getByLabelText("迁移密码"), {
      target: { value: "a-secure-migration-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "上传并检查" }));

    await waitFor(() => expect(screen.getByText("来源版本")).toBeTruthy());
    expect(screen.getByText("0.9.0")).toBeTruthy();
    expect(screen.getByText("18")).toBeTruthy();
    expect(screen.getByText("需要重新配置密钥")).toBeTruthy();
    expect(calls.slice(0, 2)).toEqual([
      expect.stringContaining("/bootstrap"),
      expect.stringContaining("/upload"),
    ]);
    expect(screen.getByRole("button", { name: "开始恢复" })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.change(screen.getByLabelText("确认短语"), {
      target: { value: "恢复此实例" },
    });
    expect(screen.getByRole("button", { name: "开始恢复" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("恢复成功后区分业务完成与重建状态，并提供登录入口", async () => {
    let statusReads = 0;
    let scheduled: (() => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/bootstrap"))
          return new Response(JSON.stringify({ csrfToken: "csrf" }), {
            status: 200,
          });
        if (url.endsWith("/upload"))
          return new Response(
            JSON.stringify({
              id: "11111111-1111-4111-8111-111111111111",
              status: "UPLOADED",
            }),
            { status: 200 },
          );
        if (url.endsWith("/preflight"))
          return new Response(
            JSON.stringify({
              id: "11111111-1111-4111-8111-111111111111",
              packageId: null,
              status: "PREFLIGHT_PASSED",
              mode: "safe",
              sourceVersion: "0.9.0",
              manifestSummary: {
                datasetCount: 1,
                totalRows: 1,
                blobCount: 0,
                blobBytes: 0,
                excludedData: [],
                warnings: [],
              },
              lastError: null,
              createdAt: "2026-11-14T00:00:00.000Z",
              updatedAt: "2026-11-14T00:00:00.000Z",
              completedAt: null,
            }),
            { status: 200 },
          );
        if (url.endsWith("/confirm"))
          return new Response(
            JSON.stringify({
              id: "11111111-1111-4111-8111-111111111111",
              status: "RESTORING",
            }),
            { status: 200 },
          );
        if (url.endsWith("/status")) {
          statusReads += 1;
          return new Response(
            JSON.stringify({
              id: "11111111-1111-4111-8111-111111111111",
              packageId: "22222222-2222-4222-8222-222222222222",
              status: statusReads === 1 ? "RESTORING" : "SUCCEEDED",
              mode: "safe",
              sourceVersion: "0.9.0",
              manifestSummary: null,
              lastError: null,
              createdAt: "2026-11-14T00:00:00.000Z",
              updatedAt: "2026-11-14T00:00:00.000Z",
              completedAt:
                statusReads === 1 ? null : "2026-11-14T00:00:01.000Z",
              rebuild: {
                status: "FAILED",
                message: "索引重建失败",
                canRetry: true,
              },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({}), { status: 404 });
      }),
    );
    render(<SetupRestoreFlow onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("选择系统备份"), {
      target: { files: [new File(["backup"], "restore.fnbak")] },
    });
    fireEvent.change(screen.getByLabelText("迁移密码"), {
      target: { value: "a-secure-migration-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "上传并检查" }));
    await waitFor(() => expect(screen.getByLabelText("确认短语")).toBeTruthy());
    const originalSetTimeout = window.setTimeout.bind(window);
    const timerSpy = vi.spyOn(window, "setTimeout").mockImplementation(((
      callback: TimerHandler,
      delay?: number,
    ) => {
      if (delay === 15_000) {
        scheduled = callback as () => void;
        return 1 as unknown as number;
      }
      return originalSetTimeout(callback, delay);
    }) as typeof window.setTimeout);
    fireEvent.change(screen.getByLabelText("确认短语"), {
      target: { value: "恢复此实例" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始恢复" }));
    await waitFor(() =>
      expect(screen.getByText("业务恢复进行中")).toBeTruthy(),
    );
    expect(statusReads).toBe(1);
    expect(scheduled).toBeTypeOf("function");
    scheduled?.();
    timerSpy.mockRestore();
    await waitFor(() => expect(screen.getByText("业务恢复成功")).toBeTruthy());
    expect(screen.getByText("索引重建失败")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "前往登录" }).getAttribute("href"),
    ).toBe("/login");
  });
});
