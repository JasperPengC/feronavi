/** 工作区页签（Round 69 对标）：纯数据层 */
import { describe, it, expect, beforeEach } from "vitest";
import { HOME_TAB, MAX_TABS, closeTab, loadTabs, openTab, resetTabsForTests, saveTabs, tabLabelKey } from "../src/client/lib/tabs.ts";

beforeEach(() => resetTabsForTests());

describe("工作区页签", () => {
  it("初始只有固定首页；路径映射到 i18n 键", () => {
    const tabs = loadTabs();
    expect(tabs).toEqual([HOME_TAB]);
    expect(tabLabelKey("/projects")).toBe("nav.projects");
    expect(tabLabelKey("/projects/11111111-1111-1111-1111-111111111111")).toBe("po.overview");
    expect(tabLabelKey("/projects/11111111-1111-1111-1111-111111111111/issues")).toBe("issues.projectTitle");
    expect(tabLabelKey("/projects/11111111-1111-1111-1111-111111111111/milestones/abc")).toBe("md.title");
    expect(tabLabelKey("/changelog")).toBe("nav.changelog");
    expect(tabLabelKey("/admin/organization")).toBe("nav.organization");
    expect(tabLabelKey("/focus")).toBe("nav.focus");
    expect(tabLabelKey("/notifications")).toBe("nav.notifications");
    expect(tabLabelKey("/projects/11111111-1111-1111-1111-111111111111/intake")).toBe("nav.intake");
  });

  it("打开页签去重、保留打开顺序", () => {
    let tabs = openTab(loadTabs(), "/projects");
    tabs = openTab(tabs, "/members");
    tabs = openTab(tabs, "/projects");
    expect(tabs.map((t) => t.path)).toEqual(["/workbench", "/projects", "/members"]);
  });

  it("超过上限丢最久页签但保留当前页", () => {
    let tabs = loadTabs();
    for (let i = 0; i < MAX_TABS + 3; i++) tabs = openTab(tabs, `/fake-${i}`);
    expect(tabs.length).toBe(MAX_TABS);
    expect(tabs[tabs.length - 1]!.path).toBe("/fake-12");
    expect(tabs.some((t) => t.path === "/fake-11")).toBe(true);
    expect(tabs.some((t) => t.path === "/fake-0")).toBe(false);
  });

  it("关闭返回相邻页；最后一个页签不可关", () => {
    const tabs = openTab(openTab(loadTabs(), "/projects"), "/members");
    const closed = closeTab(tabs, "/members");
    expect(closed.tabs.map((t) => t.path)).toEqual(["/workbench", "/projects"]);
    expect(closed.nextPath).toBe("/projects");

    const home = closeTab(tabs, "/workbench");
    expect(home.tabs.map((t) => t.path)).toEqual(["/projects", "/members"]);
    expect(home.nextPath).toBe("/projects");

    const only = closeTab([HOME_TAB], HOME_TAB.path);
    expect(only.tabs).toEqual([HOME_TAB]);
    expect(only.nextPath).toBeNull();
  });

  it("旧会话的过时 labelKey 会按当前路由表重算", () => {
    sessionStorage.setItem("feronavi-workspace-tabs-v1", JSON.stringify([
      { path: "/workbench", labelKey: "nav.overview" },
      { path: "/focus", labelKey: "nav.workItems" },
    ]));
    const tabs = loadTabs();
    expect(tabs.find((t) => t.path === "/focus")?.labelKey).toBe("nav.focus");
  });

  it("会话级持久化可恢复", () => {
    const tabs = openTab(openTab(loadTabs(), "/projects"), "/members");
    saveTabs(tabs);
    expect(loadTabs().map((t) => t.path)).toEqual(["/workbench", "/projects", "/members"]);
  });
});
