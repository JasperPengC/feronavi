import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readClientStyles } from "./support/client-styles.ts";

const tokens = readClientStyles();
const quality = readClientStyles();
const shell = readClientStyles();
const settings = readClientStyles();
const notificationSettings = readFileSync("src/client/components/settings/NotificationSettings.tsx", "utf8");
const shellComponent = readClientStyles();

describe("共享卡片节奏", () => {
  it("所有内容面板和卡片共用一个内边距令牌", () => {
    const padding = Number(tokens.match(/--card-padding:\s*(\d+)px/)?.[1]);
    expect(padding).toBeGreaterThanOrEqual(16);
    expect(padding).toBeLessThanOrEqual(24);
    expect(quality).toMatch(/\.card,\s*\.panel,\s*\.ui-panel\s*\{[^}]*padding:\s*var\(--card-padding\)/s);
  });

  it("同类指标卡使用统一高度，表单与动作按钮分别使用各自的公共高度", () => {
    expect(tokens).toMatch(/--metric-card-height:\s*118px/);
    expect(quality).toMatch(/\.metric-card,\s*\.ui-metric-card\s*\{[^}]*min-height:\s*var\(--metric-card-height\)/s);
    expect(quality).not.toMatch(/\.members-metric-grid \.metric-card\s*\{[^}]*min-height/);
    expect(quality).not.toMatch(/\.workbench-page \.metric-card\s*\{[^}]*min-height/);
    const controls = readFileSync("src/client/styles/controls.css", "utf8");
    expect(controls).toMatch(/\.input,\s*\.select-trigger,[^{]*\{[^}]*min-height:\s*var\(--control-height\)/s);
    expect(controls).toMatch(/\.btn\s*\{[^}]*min-height:\s*var\(--button-height\)/s);
    expect(tokens).not.toMatch(/\.ui-button-md\s*\{/);
    expect(quality).not.toMatch(/\.workbench-page \.workbench-todo-form \.input\s*\{[^}]*min-height:\s*38px/s);
  });

  it("贴边表格面板保留显式的零内边距变体", () => {
    expect(quality).toMatch(/\.ui-panel-padding-none[^}]*padding:\s*0\s*!important/s);
    expect(quality).toMatch(/\.table-shell[^}]*padding:\s*0\s*!important/s);
  });

  it("桌面页面和设置卡片使用统一宽度与内边距", () => {
    expect(quality).toMatch(/\.page\s*\{[^}]*width:\s*100%[^}]*max-width:\s*none/s);
    expect(shell).toMatch(/\.shell\.app-frame \.shell-content\.content-shell\s*\{[^}]*padding:\s*var\(--page-inset\)/s);
    expect(shell).toMatch(/\.shell-loading-content\s*\{[^}]*padding:\s*var\(--page-inset\)/s);
    expect(settings).toMatch(/\.settings-content \.settings-grid > \.settings-section\s*\{[^}]*padding:\s*var\(--card-padding\)/s);
  });

  it("通用表面由组件样式单一拥有，页面和外壳不再次覆盖", () => {
    const components = readFileSync("src/client/styles/components.css", "utf8");
    const pages = readFileSync("src/client/styles/pages.css", "utf8");
    const shellStyles = readFileSync("src/client/styles/shell.css", "utf8");
    const surfaces = /\.card,\s*\.panel,\s*\.ui-panel\s*\{[^}]*\}/gs;
    const definitions = [...components.matchAll(surfaces)];
    expect(definitions).toHaveLength(1);
    expect(definitions[0][0]).toMatch(/box-shadow:\s*var\(--shadow\)/);
    expect(definitions[0][0]).not.toContain("!important");
    expect(pages).not.toMatch(/\.card,\s*\.panel,\s*\.ui-panel/);
    expect(shellStyles).not.toMatch(/(?:^|\n)\.btn,\s*\.tag,\s*\.input/);
  });

  it("知识库文档树在桌面保留足够标题宽度", () => {
    expect(shellComponent).toMatch(/\.wiki-layout\s*\{[^}]*grid-template-columns:\s*240px/s);
  });

  it("窄屏知识库文档树按内容收缩，不保留桌面固定高度", () => {
    expect(quality).toMatch(/@media\s*\(max-width:\s*680px\)\s*\{[^}]*\.wiki-tree-panel\s*\{\s*min-height:\s*0/s);
    expect(quality).toMatch(/\.wiki-tree-scroll\s*\{[^}]*max-height:\s*min\(42vh,\s*320px\)/s);
  });

  it("通知渠道表头与三列数据结构一致", () => {
    const head = notificationSettings.match(/className="settings-channel-head"[\s\S]*?<\/div>/)?.[0] ?? "";
    expect((head.match(/<span(?:\s[^>]*)?>/g) ?? [])).toHaveLength(3);
  });

  it("设置页下拉控件沿用统一高度且不额外增加垂直内边距", () => {
    expect(settings).toMatch(/\.settings-section \.select-trigger\s*\{[^}]*height:\s*var\(--control-height\)[^}]*padding-block:\s*0/s);
  });

  it("设置分区使用共享 Tabs，单卡跨列且通知说明栏保持克制宽度", () => {
    const page = readFileSync("src/client/routes/SettingsPage.tsx", "utf8");
    expect(page).toContain('<PageTabs');
    expect(page).toContain('<TabPanel');
    expect(page).toContain('<SecuritySettings');
    expect(page).toContain('<AiSettings');
    expect(page).not.toContain('<SkillSettings');
    expect(settings).toMatch(/\.settings-grid > \.settings-section:only-child\s*\{[^}]*grid-column: 1 \/ -1/s);
    expect(settings).toMatch(/\.settings-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
    expect(settings).toMatch(/\.settings-grid\s*>\s*\.settings-section--full\s*\{\s*grid-column:\s*1\s*\/\s*-1\s*;/s);
    expect(settings).toMatch(/\.settings-channel-row\s*\{[^}]*max-width:\s*720px/s);
  });

  it("工作区底栏不覆盖滚动内容", () => {
    expect(quality).toMatch(/\.shell-footer\s*\{\s*margin-bottom:\s*0\s*;/s);
  });
});
