// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssistantArtifacts, type AssistantArtifactSelection } from "../src/client/components/assistant/AssistantArtifacts.tsx";
import { setLocale } from "../src/client/i18n/index.ts";
beforeEach(() => setLocale("zh-CN"));
const project = { id: "a", name: "研发", key: "DEV" };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function show(value: AssistantArtifactSelection[] = [], refs = vi.fn(), projects = [project]) {
  function Harness() {
    const [selected, setSelected] = useState(value);
    return <AssistantArtifacts projects={projects} scopeProject="a" value={selected} onChange={setSelected} onRefsChange={refs} />;
  }
  render(<Harness />); return refs;
}
it("无可上传项目和归档项目不能配置资料", () => {
  const { unmount } = render(<AssistantArtifacts projects={[]} value={[]} onChange={() => {}} onRefsChange={() => {}} />);
  expect((screen.getByRole("button", { name: "添加资料" }) as HTMLButtonElement).disabled).toBe(true);
  unmount();
  render(<AssistantArtifacts projects={[{ ...project, archived: true }]} value={[]} onChange={() => {}} onRefsChange={() => {}} />);
  expect((screen.getByRole("button", { name: "添加资料" }) as HTMLButtonElement).disabled).toBe(true);
});
it("过期文件明确标记且只发送尚有效凭据", async () => {
  const refs = show([
    { id: "expired", type: "file", label: "旧文件.csv", projectId: "a", expiresAt: "2000-01-01T00:00:00Z" },
    { id: "active", type: "credential", label: "GitHub 凭据", projectId: "a", expiresAt: "2099-01-01T00:00:00Z" },
  ]);
  expect(screen.getByText(/已到期，请重新添加/)).toBeTruthy();
  await waitFor(() => expect(refs).toHaveBeenLastCalledWith({ credentialRefs: ["active"] }));
});
it("凭据失败原样显示错误并允许重试，成功清空输入秘密", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: "VALIDATION", message: "服务地址不可访问", details: null }), { status: 400 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ credentialRef: "saved", expiresAt: "2099-01-01T00:00:00Z" }), { status: 201 }));
  vi.stubGlobal("fetch", fetcher); const refs = show();
  fireEvent.click(screen.getByRole("button", { name: "添加资料" }));
  fireEvent.click(screen.getByRole("button", { name: "配置凭据" }));
  fireEvent.change(screen.getByLabelText(/^访问令牌/), { target: { value: "synthetic-password-fixture" } });
  fireEvent.click(screen.getByRole("button", { name: "保存凭据" }));
  await screen.findByText("服务地址不可访问");
  expect(screen.getByDisplayValue("synthetic-password-fixture")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "保存凭据" }));
  await screen.findByText("GitHub 凭据");
  expect(screen.queryByDisplayValue("synthetic-password-fixture")).toBeNull();
  await waitFor(() => expect(refs).toHaveBeenLastCalledWith({ credentialRefs: ["saved"] }));
  expect(screen.queryByText("synthetic-password-fixture")).toBeNull();
});
it("文件超限不会发请求，已有文件仍可移除", async () => {
  const value: AssistantArtifactSelection[] = Array.from({ length: 10 }, (_, index) => ({ id: `f${index}`, label: `文件${index}.csv`, type: "file", projectId: "a", expiresAt: "2099-01-01T00:00:00Z" }));
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }))); vi.stubGlobal("fetch", fetcher);
  show(value);
  fireEvent.click(screen.getByRole("button", { name: "添加资料" }));
  fireEvent.change(screen.getByLabelText("选择文件"), { target: { files: [new File(["标题"], "新增.csv", { type: "text/csv" })] } });
  await screen.findByText(/每条消息最多附带10个文件/);
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "移除文件0.csv" }));
  await waitFor(() => expect(screen.queryByText("文件0.csv")).toBeNull());
  expect(fetcher).toHaveBeenCalledTimes(1);
});
