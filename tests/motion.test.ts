/**
 * 交互动效的可回归约束（收尾第 49 轮）
 *
 * 为什么用"读 CSS 文本"来测：动效的正确性有两个**结构性**要求，
 * 它们比视觉效果更该被守护 ——
 *   ① 所有动画/过渡必须在 `prefers-reduced-motion: no-preference` 内（尊重偏好是默认成立的，
 *      而不是"记得去关"）；② 焦点可见指示**不得**被动效偏好影响（那是无障碍要求，不是装饰）。
 * 视觉本身仍以浏览器截图/断言验收；这里锁的是"结构不会退化"。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readClientStyles } from "./support/client-styles.ts";

const css = readClientStyles();

/** 取出某个 @media 块的正文（支持嵌套一层大括号计数） */
function mediaBlock(source: string, query: string): string | null {
  const blocks: string[] = [];
  let offset = 0;
  while (offset < source.length) {
    const start = source.indexOf(query, offset);
    if (start < 0) break;
    const open = source.indexOf("{", start);
    let depth = 0;
    for (let j = open; j < source.length; j++) {
      if (source[j] === "{") depth++;
      else if (source[j] === "}" && --depth === 0) {
        blocks.push(source.slice(open + 1, j)); offset = j + 1; break;
      }
    }
  }
  return blocks.length ? blocks.join("\n") : null;
}

describe("按钮体系（结构约束）", () => {
  const css2 = readClientStyles();
  it("五个变体、三种尺寸、禁用与加载态都在", () => {
    for (const sel of [".btn-primary", ".btn-danger", ".btn-ghost", ".btn-icon", ".btn-sm", ".btn-lg"]) {
      expect(css2, `应定义 ${sel}`).toContain(sel);
    }
    expect(css2).toMatch(/\.btn:disabled\s*\{[^}]*cursor:\s*not-allowed/);
    expect(css2).toMatch(/\.btn\.is-loading::after\s*\{/);
  });
  it("图标按钮是正方形，且宽度随尺寸成套变化（不写死一个值）", () => {
    // 以当前生产样式为准；旧 28/44px 声明已被后续 32/36px 规则覆盖并清理。
    expect(css2).toMatch(/\.btn-icon\s*\{[^}]*width:\s*36px/);
    expect(css2).toMatch(/\.btn-icon\.btn-sm\s*\{[^}]*width:\s*32px/);
    expect(css2).toMatch(/\.btn-icon\.btn-lg\s*\{[^}]*width:\s*36px/);
  });
  it("按钮使用统一控件圆角（Round 112：8px，非胶囊）", () => {
    expect(css2).toMatch(/\.btn \{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
  });

  it("reduce 下有**全局关断开关**兜底（所有动画时长归零 + 只播一次）", () => {
    // 这条断言是为了"锁住保护"：cascade 里一旦有人删掉这个开关，
    // 那些声明在守卫外的旧动画在 reduce 模式下就会真的播放（前庭敏感用户会被伤到）。
    expect(css2).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\*,\s*\*::before,\s*\*::after\s*\{[\s\S]*?animation-duration:\s*0\.001ms\s*!important/);
    expect(css2).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?animation-iteration-count:\s*1\s*!important/);
  });

  it("加载动画也归入动效守卫（reduce 下放慢或不动）", () => {
    expect(css2).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.btn\.is-loading::after/);
  });
});

describe("未登录页外形统一（结构约束）", () => {
  it("重置 / 改密统一用 auth-card，不写死卡片宽度与内边距", () => {
    for (const r of ["ResetPasswordPage", "ChangePasswordPage"]) {
      const src = readFileSync(`src/client/routes/${r}.tsx`, "utf-8");
      expect(src, `${r} 应使用 auth-card`).toContain("auth-card");
      // 不允许再出现「card + 写死 width/padding」的组合（那正是此前不一致的来源）
      expect(src, `${r} 不应再写死宽度与内边距`).not.toMatch(/className="card"\s+style=\{\{\s*width:\s*\d+/);
    }
  });
  it("安装向导用独立的向导布局（左步骤条 + 右内容），不再套 auth-card", () => {
    const src = readFileSync("src/client/routes/SetupPage.tsx", "utf-8");
    expect(src).toContain("setup-frame");
    expect(src).toContain("setup-rail");
    expect(src).toContain("setup-content");
    expect(src, "向导不应再套登录卡样式").not.toContain("auth-card");
  });
  it("auth-card 有窄屏收内边距；向导卡有最大宽度与矮屏上限", () => {
    expect(css).toContain(".auth-card {");
    expect(css).toMatch(/@media \(max-width: 480px\)[\s\S]*?\.auth-card \{/);
    expect(css).toContain(".setup-frame {");
    expect(css).toMatch(/\.setup-frame \{[^}]*max-width: 1060px/);
    expect(css).toMatch(/\.setup-frame \{[^}]*max-height: calc\(100dvh/);
  });
});

describe("交互动效的结构约束", () => {
  it("存在 no-preference 守卫，且动画都在其中定义", () => {
    const block = mediaBlock(css, "@media (prefers-reduced-motion: no-preference)");
    expect(block, "必须存在 no-preference 守卫块").toBeTruthy();
    // 本轮新增的三类动效必须都在守卫内
    for (const marker of ["fn-popover-in", ":active", "@media (hover: hover)"]) {
      expect(block!, `守卫块内应包含 ${marker}`).toContain(marker);
    }
  });

  it("存在 reduce 守卫（减少动效是浏览器的默认路径，应有显式处理）", () => {
    expect(mediaBlock(css, "@media (prefers-reduced-motion: reduce)")).toBeTruthy();
  });

  it("焦点可见指示不得被写入动效守卫内（无障碍要求，任何偏好下都要有）", () => {
    const noPref = mediaBlock(css, "@media (prefers-reduced-motion: no-preference)") ?? "";
    const reduce = mediaBlock(css, "@media (prefers-reduced-motion: reduce)") ?? "";
    expect(noPref).not.toContain(":focus-visible");
    expect(reduce).not.toContain(":focus-visible");
    expect(css).toContain(":focus-visible");
  });

  it("抽屉与弹窗编排也在守卫内，且时长一致、不循环", () => {
    const block = mediaBlock(css, "@media (prefers-reduced-motion: no-preference)") ?? "";
    for (const m of ["fn-drawer-in", "fn-modal-in", ".shell-scrim"]) {
      expect(block, `守卫块内应包含 ${m}`).toContain(m);
    }
    // 抽屉与遮罩时长必须一致（错拍会被看出来）
    expect(block).toMatch(/\.shell-sidebar[^}]*transition:\s*transform\s+200ms/);
    expect(block).toMatch(/\.shell-scrim[^}]*transition:\s*opacity\s+200ms/);
  });

  it("弹窗用放大而非缩小入场（缩小会被读成“缩回去”，语义相反）", () => {
    const block = mediaBlock(css, "@media (prefers-reduced-motion: no-preference)") ?? "";
    expect(block).toMatch(/fn-modal-in[\s\S]*?from\s*\{[^}]*scale\(0\.98\)/);
  });

  it("数据行与卡片不逐项入场，避免刷新与筛选时内容跳动", () => {
    const block = mediaBlock(css, "@media (prefers-reduced-motion: no-preference)") ?? "";
    expect(block).not.toContain("fn-row-in");
    expect(block).not.toMatch(/(?:tbody tr|\.widget-card)[^{]*\{[^}]*animation:/);
  });
});
