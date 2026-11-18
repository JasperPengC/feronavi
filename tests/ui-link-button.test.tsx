/**
 * 链接 / 按钮**语义**测试（用户要求：按场景区分 link 与 button）
 *
 * 守的是**语义**，不是样式：
 *   · 跳转/下载 → 必须渲染 `<a>`（可中键新开、可复制 URL、读屏为「链接」）；
 *   · 动作（提交/删除/开关）→ 必须渲染 `<button>`（可被表单提交、可聚焦、读屏为「按钮」）。
 * 样式上两者共用 `.btn` 一套类，保证视觉一致。
 */
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Button } from "../src/client/components/ui/Button.tsx";
import { ExternalLinkButton } from "../src/client/components/ui/LinkButton.tsx";

// ⚠️ 本测试项目没有自动 cleanup —— 不清理会在后续用例里残留上一个用例的 DOM（"Found multiple button"）
afterEach(cleanup);

describe("按钮语义", () => {
  it("<Button> 渲染真 button，默认 type=button（不会误触发表单提交）", () => {
    render(<Button>保存</Button>);
    const el = screen.getByRole("button", { name: "保存" });
    expect(el.tagName).toBe("BUTTON");
    expect(el.getAttribute("type")).toBe("button");
  });

  it("变体与尺寸映射到成熟的 .btn 类（老代码外观不变）", () => {
    const { rerender } = render(<Button variant="primary" size="sm">新建</Button>);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("btn");
    expect(cls).toContain("btn-primary");
    expect(cls).toContain("btn-sm");
    rerender(<Button variant="danger" size="lg">删除</Button>);
    const cls2 = screen.getByRole("button").className;
    expect(cls2).toContain("btn-danger");
    expect(cls2).toContain("btn-lg");
  });

  it("loading 时禁用并标记 aria-busy", () => {
    render(<Button loading>提交</Button>);
    const el = screen.getByRole("button");
    expect((el as HTMLButtonElement).disabled).toBe(true);   // 用原生属性（本项目未装 jest-dom matcher）
    expect(el.getAttribute("aria-busy")).toBe("true");
  });

  it("<ExternalLinkButton> 渲染真 <a>（下载/外链可新开、可复制地址）——不是伪造的按钮", () => {
    render(<ExternalLinkButton href="/api/v1/me/data-export" download>导出</ExternalLinkButton>);
    const el = screen.getByRole("link", { name: "导出" });
    expect(el.tagName).toBe("A");
    expect(el.getAttribute("href")).toBe("/api/v1/me/data-export");
    expect(el.hasAttribute("download")).toBe(true);
    expect(el.className).toContain("btn");     // 样式同样是按钮
  });
});
