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
it("文档只省略与页面标题相同的首个一级标题，正文和后续标题保留", () => {
  const source = "# **开发规范**\n\n正文不变\n\n## 开发规范\n\n# 其它章节";
  render(<MarkdownView text={source} documentTitle="开发规范" />);
  expect(screen.queryByRole("heading", { name: "开发规范", level: 1 })).toBeNull();
  expect(screen.getByRole("heading", { name: "开发规范", level: 2 })).toBeTruthy();
  expect(screen.getByText("正文不变")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "其它章节", level: 1 })).toBeTruthy();
});
it.each([
  ["# 不同标题", "不同标题"],
  ["引言\n\n# 开发规范", "开发规范"],
  ["# [开发规范](https://example.com)", "开发规范"],
])("文档保留不同、非首行或带链接的标题：%s", (text, heading) => {
  render(<MarkdownView text={text} documentTitle="开发规范" />);
  expect(screen.getByRole("heading", { name: heading, level: 1 })).toBeTruthy();
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
  expect(screen.queryByRole("link", { name: "危险" })).toBeNull();
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
it("旧文档中的本地路径和相对文件链接不再生成站内跳转或图片请求", () => {
  render(<MarkdownView text={'[源文件](/Users/dev/code.ts:12)\n\n[相对文件](../readme.md)\n\n![本地图片](/tmp/picture.png)\n\n[文档](/projects/p/wiki?page=id)'} />);
  expect(screen.queryByRole("link", { name: "源文件" })).toBeNull();
  expect(screen.queryByRole("link", { name: "相对文件" })).toBeNull();
  expect(screen.getByText("源文件").getAttribute("title")).toContain("/Users/dev/code.ts:12");
  expect(screen.queryByRole("img", { name: "本地图片" })).toBeNull();
  expect(screen.getByRole("link", { name: "文档" }).getAttribute("href")).toBe("/projects/p/wiki?page=id");
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
