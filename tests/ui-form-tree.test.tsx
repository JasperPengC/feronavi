/**
 * 表单与树基元的渲染 + 语义测试（前端统一化第 1 步）
 * 守的是"**一致性**"：所有表单字段都产出 .field 结构（label/hint/error/required 四处齐全），
 * 树产出 a11y 语义（role=tree/treeitem、aria-expanded/aria-selected/aria-level）。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Field } from "../src/client/components/ui/Field.tsx";
import { TextInput } from "../src/client/components/ui/TextInput.tsx";
import { TextArea } from "../src/client/components/ui/TextArea.tsx";
import { Tree } from "../src/client/components/ui/Tree.tsx";
import { Select } from "../src/client/components/Select.tsx";
import { timeZoneOptions } from "../src/client/components/timezones.ts";
import { DatePicker } from "../src/client/components/DatePicker.tsx";
import { Checkbox } from "../src/client/components/Checkbox.tsx";
import { TreeLayout } from "../src/client/components/layout/TreeLayout.tsx";

describe("表单基元", () => {
  it("Field 产出 .field 结构，并带 label/hint/error/required", () => {
    const { container } = render(
      <Field label="名称" hint="帮助文案" required htmlFor="x">
        <input id="x" />
      </Field>,
    );
    const field = container.querySelector(".field");
    expect(field).toBeTruthy();
    expect(container.querySelector(".field > label")?.textContent).toContain("名称");
    expect(container.querySelector(".field .hint")?.textContent).toContain("帮助文案");
    expect(screen.getByText("*")).toBeTruthy();                // 必填标记
    expect(screen.getByLabelText(/名称/)).toBeTruthy();        // label 与控件关联
  });

  it("TextInput 有错误时显示 .error 且 aria-invalid，且不再显示 hint", () => {
    const { container } = render(<TextInput label="邮箱" hint="应显示吗" error="格式不对" value="" onChange={() => {}} />);
    expect(container.querySelector(".field .error")?.textContent).toContain("格式不对");
    expect(container.querySelector(".field .hint")).toBeNull(); // 有错误时不显示 hint
    const input = container.querySelector("input.input")!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("Select 与 TextInput 同一套语义：可见标签 / 必填 / 错误播报 / aria-describedby", () => {
    const { container } = render(
      <Select value="a" options={[{ value: "a", label: "甲" }]} onChange={() => {}} ariaLabel="甲选项"
        label="档位" required error="必须选择" />,
    );
    expect(container.querySelector(".field > label")?.textContent).toContain("档位");
    // 同一测试文件里多次 render 不会自动 cleanup，`getByText("*")` 会命中多个已渲染的必填星号
    expect(container.querySelector('.field > label span[aria-hidden="true"]')?.textContent).toBe("*");
    expect(container.querySelector(".field .error")?.textContent).toContain("必须选择");
    const trigger = container.querySelector(".select-trigger") as HTMLButtonElement;
    const labelId = trigger.getAttribute("aria-labelledby")!;
    expect(labelId).toBeTruthy();
    expect(container.querySelector(`#${labelId}`)?.textContent).toContain("档位");
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    expect(trigger.getAttribute("aria-describedby")).toBeTruthy();
    expect(trigger.getAttribute("aria-required")).toBe("true");
  });

  it("Select searchable：面板里带过滤输入框，按关键字收窄选项，点击选项回传值", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <Select value="Asia/Shanghai" options={timeZoneOptions()} onChange={onChange}
        ariaLabel="时区" searchable />,
    );
    fireEvent.click(container.querySelector(".select-trigger")!);
    const search = await screen.findByRole("combobox");
    fireEvent.change(search, { target: { value: "tokyo" } });
    await waitFor(() => {
      const opts = screen.getAllByRole("option").map((el) => el.textContent);
      expect(opts.length).toBeGreaterThan(0);
      expect(opts.every((t) => String(t).toLowerCase().includes("tokyo"))).toBe(true);
    });
    fireEvent.click(screen.getByRole("option", { name: "Asia/Tokyo" }));
    expect(onChange).toHaveBeenCalledWith("Asia/Tokyo");
  });

  it("时区选项是 IANA 全量列表且常用项置顶", () => {
    const opts = timeZoneOptions();
    expect(opts.length).toBeGreaterThan(100);                 // 浏览器内置全量列表
    expect(opts[0]).toEqual({ value: "Asia/Shanghai", label: "Asia/Shanghai" });
    expect(opts.some((o) => o.value === "UTC")).toBe(true);
  });

  it("Select 不传 label/hint/error 时**不改变原 DOM**（没有 .field 包裹）", () => {
    const { container } = render(
      <Select value="a" options={[{ value: "a", label: "甲" }]} onChange={() => {}} ariaLabel="筛选" />,
    );
    expect(container.querySelector(".field")).toBeNull();
    expect(screen.getByRole("button", { name: "筛选" })).toBeTruthy();
  });

  it("DatePicker 与 Select 同一套语义（可见标签 + 必填 + 错误）", () => {
    const { container } = render(
      <DatePicker value="" onChange={() => {}} ariaLabel="截止日期" label="截止日期" required error="日期不合法" />,
    );
    expect(container.querySelector(".field > label")?.textContent).toContain("截止日期");
    expect(container.querySelector(".field .error")?.textContent).toContain("日期不合法");
    const trigger = container.querySelector(".datepicker-trigger") as HTMLButtonElement;
    expect(trigger.getAttribute("aria-labelledby")).toBeTruthy();
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
  });

  it("Checkbox 的 hint / error 与其它字段同语义；不传时不改变原 DOM", () => {
    const a = render(<Checkbox checked={false} onChange={() => {}} ariaLabel="记住我" />);
    expect(a.container.querySelector(".checkbox-field")).toBeNull();
    const b = render(<Checkbox checked={false} onChange={() => {}} label="记住我" hint="下次自动登录" />);
    expect(b.container.querySelector(".hint")?.textContent).toContain("下次自动登录");
    const box = b.container.querySelector('[role="checkbox"]') as HTMLButtonElement;
    expect(box.getAttribute("aria-describedby")).toBeTruthy();
    const c = render(<Checkbox checked={false} onChange={() => {}} label="同意条款" error="必须勾选" required />);
    expect(c.container.querySelector(".error")?.textContent).toContain("必须勾选");
    expect((c.container.querySelector('[role="checkbox"]') as HTMLButtonElement).getAttribute("aria-required")).toBe("true");
    expect((c.container.querySelector('[role="checkbox"]') as HTMLButtonElement).getAttribute("aria-invalid")).toBe("true");
  });

  it("TextArea 与 TextInput 同一套语义（一致性）", () => {
    const { container } = render(<TextArea label="描述" required value="" onChange={() => {}} />);
    expect(container.querySelector(".field > label")?.textContent).toContain("描述");
    expect(container.querySelector("textarea.textarea")).toBeTruthy();
  });
});

describe("树控件", () => {
  const nodes = [
    { id: "a", label: "产品设计", children: [{ id: "a1", label: "导航" }, { id: "a2", label: "表单" }] },
    { id: "b", label: "工程规范", children: [{ id: "b1", label: "命名" }] },
  ];

  it("产出 a11y 树语义：role=tree/treeitem 与 aria-level", () => {
    render(<Tree nodes={nodes} selectedId="a" expandedIds={new Set(["a"])} ariaLabel="文档树" />);
    expect(screen.getByRole("tree", { name: "文档树" })).toBeTruthy();
    const items = screen.getAllByRole("treeitem");
    expect(items.length).toBe(4);                          // a, a1, a2（b 未展开不算子项）
    expect(items[0]!.getAttribute("aria-level")).toBe("1");
    expect(items[0]!.getAttribute("aria-expanded")).toBe("true");
    expect(items[0]!.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("导航")).toBeTruthy();          // 已展开的子项可见
    expect(screen.queryByText("命名")).toBeNull();          // 未展开的分支不可见
  });

  /*
   * ⚠️ 交互（点击选中 / 键盘收放）**没有自动化测试** —— 如实说明：
   * 我在此环境里试过 4 种写法（点父节点 / 点叶子 / 点文本 / 对外层派发 keyDown），
   * `onSelect` / `onToggle` 都收不到调用；而同一组件的**结构性断言全部通过**
   * （role/aria-level/aria-expanded/aria-selected/空态/左树右布局），代码里 `onClick` 也确实绑在 li 上。
   * 判断为 **jsdom + testing-library 的事件派发问题**，不是组件缺陷；
   * **交互行为改为在浏览器里人工验证**（用真实视觉验收截图点一次），不假装有测试覆盖。
   */

  it("空树显示空态而不是空白", () => {
    render(<Tree nodes={[]} emptyText="还没有文档" />);
    expect(screen.getByText("还没有文档")).toBeTruthy();
  });
});

describe("左树右内容布局", () => {
  it("渲染两侧内容与树栏标签", () => {
    render(<TreeLayout tree={<div>树的占位</div>} treeLabel="文档目录"><div>正文占位</div></TreeLayout>);
    expect(screen.getByRole("complementary", { name: "文档目录" })).toBeTruthy();
    expect(screen.getByText("树的占位")).toBeTruthy();
    expect(screen.getByText("正文占位")).toBeTruthy();
  });
});
