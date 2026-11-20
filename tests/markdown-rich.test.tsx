import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MarkdownView } from "../src/client/components/ui/MarkdownView.tsx";
import { setLocale } from "../src/client/i18n/index.ts";
const renderer = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock("mermaid", () => ({ default: renderer }));
beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); renderer.render.mockReset(); renderer.initialize.mockReset(); });
it("渲染标题、列表、表格、任务、删除线和代码块", () => {
  render(<MarkdownView text={'## 月结验收\n\n- [x] 完成回归\n- [ ] 财务复核\n\n| 项目 | 截止 |\n| --- | --- |\n| 门户 | 第3工作日 |\n\n~~旧规则~~\n\n```ts\nconst day = 3;\n```'} />);
  expect(screen.getByRole("heading", { name: "月结验收" })).toBeTruthy();
  expect(screen.getByRole("table")).toBeTruthy(); expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  expect(document.querySelector("del")?.textContent).toBe("旧规则");
  expect(document.querySelector("pre code")?.textContent).toContain("const day = 3;");
});
it("Mermaid异步渲染到禁止脚本和外连的隔离图表，仍可查看源码", async () => {
  renderer.render.mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><text>月结审核</text></svg>' });
  render(<MarkdownView text={'```mermaid\nflowchart LR\n  A[月结] --> B[审核]\n```'} />);
  const frame = await screen.findByTitle("Mermaid 图表");
  expect(frame.getAttribute("sandbox")).toBe("");
  expect(frame.getAttribute("srcdoc")).toContain("default-src 'none'");
  expect(renderer.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: "strict", startOnLoad: false, layout: "dagre" }));
  fireEvent.click(screen.getByRole("button", { name: "适合宽度" }));
  expect(screen.getByRole("button", { name: "原始尺寸" })).toBeTruthy();
  fireEvent.click(screen.getByText("查看图表源码", { selector: "summary" }));
  expect(screen.getByText(/A\[月结\] --> B\[审核\]/)).toBeTruthy();
});
it("无效Mermaid可读降级且不会使整个回答崩溃", async () => {
  renderer.render.mockRejectedValue(new Error("parse failed"));
  render(<MarkdownView text={'这是保留的回答。\n\n```mermaid\ninvalid graph\n```'} />);
  await screen.findByText("图表暂时无法渲染，可查看源码。");
  expect(screen.getByText("这是保留的回答。")).toBeTruthy();
  expect(screen.getByText("invalid graph")).toBeTruthy();
});
it("不执行原始HTML、危险URL或代码块里的引用标记", async () => {
  render(<MarkdownView text={'<script>alert(1)</script>\n\n[危险](javascript:alert(1))\n\n`[1]`'} />);
  await waitFor(() => expect(document.querySelector("script")).toBeNull());
  expect(screen.getByText("危险").getAttribute("href")).not.toContain("javascript:");
  expect(document.querySelector("code")?.textContent).toBe("[1]");
});
it("仅真实正文引用可点击，代码与既有链接保持原义", () => {
  render(<MarkdownView text={'规则 **见 [1]**，未知 [9]。\n\n`[1]`\n\n```txt\n[1]\n```\n\n[已有链接 [1]](https://example.com)'} citations={[{ href: "/projects/p/wiki?page=doc", label: "门户 · 月结规则" }]} />);
  const link = screen.getByRole("link", { name: "[1] 门户 · 月结规则" });
  expect(link.getAttribute("href")).toBe("/projects/p/wiki?page=doc");
  expect(document.querySelectorAll(".markdown-citation")).toHaveLength(1);
  expect(document.querySelectorAll("code")).toHaveLength(2);
  expect(screen.getByRole("link", { name: "已有链接 [1]" }).getAttribute("href")).toBe("https://example.com");
});
it("图表内的配置不覆盖渲染器安全策略", async () => {
  renderer.render.mockResolvedValue({ svg: '<svg viewBox="0 0 10 10" />' });
  render(<MarkdownView text={'```mermaid\n%%{init: {"securityLevel": "loose", "themeCSS": "body {display:none}"}}%%\nflowchart LR\n A-->B\n```'} />);
  await screen.findByTitle("Mermaid 图表");
  expect(renderer.render.mock.calls[0]?.[1]).not.toContain("securityLevel");
});
it("缩进frontmatter同样不能改写图表配置", async () => {
  renderer.render.mockResolvedValue({ svg: '<svg viewBox="0 0 10 10" />' });
  render(<MarkdownView text={'```mermaid\n  ---  \n  config:\n    theme: dark\n  ---  \nflowchart LR\n A-->B\n```'} />);
  await screen.findByTitle("Mermaid 图表");
  expect(renderer.render.mock.calls[0]?.[1]).not.toContain("config:");
});
it("流式Mermaid保留源码，完成后才绘图", async () => {
  renderer.render.mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><text>ok</text></svg>' });
  const source = '```mermaid\nflowchart LR\n A --> B\n```';
  const view = render(<MarkdownView text={source} streaming />);
  expect(document.querySelector(".markdown-diagram")).toBeNull();
  expect(document.querySelector("pre code")?.textContent).toContain("A --> B");
  expect(screen.queryByTitle("Mermaid 图表")).toBeNull();
  view.rerender(<MarkdownView text={source} />);
  await screen.findByTitle("Mermaid 图表");
});
