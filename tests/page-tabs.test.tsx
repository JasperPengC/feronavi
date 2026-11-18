import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { PageTabs, TabPanel } from "../src/client/components/ui/PageTabs.tsx";

afterEach(cleanup);

function Example() {
  const [tab, setTab] = useState("general");
  return <>
    <PageTabs id="settings" label="设置分区" value={tab} onChange={setTab}
      tabs={[{ value: "general", label: "基本信息" }, { value: "security", label: "账号安全" }]} />
    <TabPanel tabsId="settings" value="general" activeValue={tab}><input aria-label="名称" defaultValue="原名称" /></TabPanel>
    <TabPanel tabsId="settings" value="security" activeValue={tab}><button>配置安全</button></TabPanel>
  </>;
}

describe("页面分区 Tabs", () => {
  it("未访问分区不执行内容求值", () => {
    const content = vi.fn(() => <button>内容</button>);
    const mounted = render(<TabPanel tabsId="lazy" value="details" activeValue="overview">{content}</TabPanel>);
    expect(content).not.toHaveBeenCalled();
    mounted.rerender(<TabPanel tabsId="lazy" value="details" activeValue="details">{content}</TabPanel>);
    expect(content).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "内容" })).toBeTruthy();
  });
  it("建立选项与内容关系，只挂载访问过的内容，切换后保留草稿", () => {
    render(<Example />);
    const general = screen.getByRole("tab", { name: "基本信息" });
    expect(general.getAttribute("aria-controls")).toBe(screen.getByRole("tabpanel").id);
    expect(screen.queryByText("配置安全")).toBeNull();
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "尚未保存" } });
    fireEvent.click(screen.getByRole("tab", { name: "账号安全" }));
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "配置安全" })).toBeTruthy();
    fireEvent.click(general);
    expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe("尚未保存");
  });

  it("方向键和 Home/End 切换，Tab 顺序只包含当前选项", () => {
    render(<Example />);
    const general = screen.getByRole("tab", { name: "基本信息" });
    const security = screen.getByRole("tab", { name: "账号安全" });
    general.focus();
    fireEvent.keyDown(general, { key: "ArrowRight" });
    expect(document.activeElement).toBe(security);
    expect(security.getAttribute("aria-selected")).toBe("true");
    expect(general.tabIndex).toBe(-1);
    fireEvent.keyDown(security, { key: "Home" });
    expect(document.activeElement).toBe(general);
    fireEvent.keyDown(general, { key: "End" });
    expect(document.activeElement).toBe(security);
  });

  it("禁用选项不响应点击或键盘切换", () => {
    const change = vi.fn();
    render(<PageTabs id="busy" label="导入" value="upload" onChange={change}
      tabs={[{ value: "upload", label: "导入" }, { value: "history", label: "记录", disabled: true }]} />);
    fireEvent.click(screen.getByRole("tab", { name: "记录" }));
    fireEvent.keyDown(screen.getByRole("tab", { name: "导入" }), { key: "ArrowRight" });
    expect(change).not.toHaveBeenCalled();
  });
});
