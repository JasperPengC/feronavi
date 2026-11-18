import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Tree } from "../src/client/components/ui/Tree.tsx";

afterEach(cleanup);
const nodes = [
  { id: "a", label: "项目说明", children: [{ id: "child", label: "操作步骤" }] },
  { id: "skip", label: "不可用", disabled: true },
  { id: "b", label: "开发规范" },
];

it("未选中时可用Tab进入，方向键移动可见焦点，Enter才打开文档", () => {
  const select = vi.fn();
  render(<Tree nodes={nodes} expandedIds={new Set(["a"])} onSelect={select} />);
  const first = screen.getAllByRole("treeitem")[0]!;
  expect(first.tabIndex).toBe(0);
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(document.activeElement?.textContent).toBe("操作步骤");
  expect(select).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
  expect(document.activeElement?.textContent).toBe("开发规范");
  fireEvent.keyDown(document.activeElement!, { key: "Enter" });
  expect(select).toHaveBeenCalledWith("b");
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(document.activeElement).toBe(first);
});

it("左右键展开、进入子级和返回父级，禁用节点不参与选择", () => {
  const select = vi.fn(); const toggle = vi.fn();
  const { rerender } = render(<Tree nodes={nodes} selectedId="a" onSelect={select} onToggle={toggle} />);
  const first = screen.getAllByRole("treeitem")[0]!;
  first.focus(); fireEvent.keyDown(first, { key: "ArrowRight" });
  expect(toggle).toHaveBeenCalledWith("a");
  rerender(<Tree nodes={nodes} selectedId="a" expandedIds={new Set(["a"])} onSelect={select} onToggle={toggle} />);
  fireEvent.keyDown(first, { key: "ArrowRight" });
  expect(document.activeElement?.textContent).toBe("操作步骤");
  fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(first);
  fireEvent.click(screen.getByText("不可用"));
  expect(select).not.toHaveBeenCalled();
});
