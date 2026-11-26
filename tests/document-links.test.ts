import { expect, it } from "vitest";
import { documentLinkIssues, assertDocumentLinks } from "../src/shared/document-links.ts";
import { markdownLinkIssue } from "../src/shared/markdown-links.ts";

it.each([
  "/Users/dev/project/file.ts:12", "/home/dev/readme.md", "/var/tmp/a.png", "/opt/project/doc.md",
  "file:///tmp/a.md", "C:/work/a.md", "C:\\work\\a.md", "\\\\server\\share\\a.md", "~/code/a.md",
  "/%55sers/dev/a.md", "vscode://file/Users/dev/a.md", "sandbox:/mnt/data/a.png",
  "/data/project/a.md", "/projects/../Users/dev/a.md", "/projects/%2e%2e/%55sers/dev/a.md", "/srv/repo/a.md",
])("阻止本机路径链接 %s", (url) => {
  expect(markdownLinkIssue(url)).toBe("LOCAL_PATH");
});
it.each(["./guide.md", "../guide.md", "src/server.ts", "readme.md", "//server/share/doc.md"])("不把相对文件路径猜为站内地址 %s", (url) => {
  expect(markdownLinkIssue(url)).toBe("RELATIVE_PATH");
});
it.each(["https://example.com/repo/blob/abc/src/a.ts#L2", "http://localhost:51476/projects/p/wiki?page=id", "/projects/p/wiki?page=id", "/api/v1/attachments/id/download", "#section", "?page=id", "mailto:dev@example.com"])("保留明确网页目标 %s", (url) => {
  expect(markdownLinkIssue(url)).toBeNull();
});
it("按 Markdown 语法校验内联/引用链接及图片，忽略代码与未使用定义", () => {
  const source = '[源码](</Users/dev/a b.ts:2>)\n\n![图片](/tmp/a.png)\n\n[章节][Part]\n\n[part]: ../guide.md\n[unused]: /Users/no.md\n\n`[示例](/Users/code)`\n\n```md\n[演示](./example.md)\n```';
  const issues = documentLinkIssues(source);
  expect(issues.map(x => [x.url, x.line, x.reason])).toEqual([
    ["/Users/dev/a b.ts:2", 1, "LOCAL_PATH"], ["/tmp/a.png", 3, "LOCAL_PATH"], ["../guide.md", 5, "RELATIVE_PATH"],
  ]);
  expect(() => assertDocumentLinks(source)).toThrow(/第 1 行/);
  try { assertDocumentLinks(source); } catch (error) {
    expect(error).toMatchObject({ code: "VALIDATION", details: { issues: expect.arrayContaining([expect.objectContaining({ line: 1, reason: "LOCAL_PATH" })]) } });
  }
});
it("不接受临时图片地址、空目标和危险协议，不改变原文", () => {
  for (const url of ["draft-image:123", "blob:https://site/id", "data:image/png;base64,AA", "javascript:alert(1)", ""]) {
    expect(markdownLinkIssue(url)).toBe("UNSUPPORTED_URL");
  }
  expect(documentLinkIssues('路径示例 `/Users/dev/a.md` 与 `../guide.md`')).toEqual([]);
});
