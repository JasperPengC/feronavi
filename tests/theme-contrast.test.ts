import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readClientStyles } from "./support/client-styles.ts";

const tokens = readFileSync(resolve(process.cwd(), "src/client/styles/tokens.css"), "utf8");
const shell = readClientStyles();

function theme(name: "light" | "dark") {
  const block = tokens.match(new RegExp(`\\.theme-${name}\\s*\\{([^}]*)\\}`))?.[1];
  if (!block) throw new Error(`Missing theme ${name}`);
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[\da-f]{3,8})\s*;/gi)].map(([, key, value]) => [key!, value!]));
}

function luminance(hex: string) {
  const value = hex.slice(1);
  const rgb = [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16));
  const channel = (n: number) => {
    const normalized = n / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb[0]!) + 0.7152 * channel(rgb[1]!) + 0.0722 * channel(rgb[2]!);
}

function contrast(foreground: string, background: string) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

describe("主题可读性回归", () => {
  it.each(["light", "dark"] as const)("%s 外壳、画布和内容卡片保持可辨认的明暗层级", (name) => {
    const t = theme(name);
    const chrome = t["--surface-chrome"]!;
    const canvas = t["--surface-workbench"]!;
    const panel = t["--surface-panel"]!;
    // 产品表面分层阈值，不代表 WCAG 文字或控件的对比度要求。
    expect(contrast(chrome, canvas)).toBeGreaterThanOrEqual(name === "dark" ? 1.15 : 1.08);
    expect(contrast(canvas, panel)).toBeGreaterThanOrEqual(1.15);
    expect(luminance(panel)).toBeGreaterThan(luminance(canvas));
    if (name === "dark") expect(luminance(canvas)).toBeGreaterThan(luminance(chrome));
    for (const surface of [chrome, canvas, panel, t["--surface-raised"]!]) {
      expect(contrast(t["--text-faint"]!, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(["light", "dark"] as const)("%s 主题正文和主要控件在实际表面上达到可读对比度", (name) => {
    const t = theme(name);
    const textColors = ["--text", "--text-soft", "--text-muted"];
    for (const foreground of textColors) {
      for (const background of ["--bg", "--bg-subtle", "--bg-muted", "--surface-panel", "--surface-3"]) {
        expect(contrast(t[foreground]!, t[background]!)).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast(t["--danger"]!, t["--danger-bg"]!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--primary-fg"]!, t["--primary"]!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--primary-fg"]!, t["--primary-hover"]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["light", "--text-faint"], ["light", "--blue"],
    ["dark", "--text-faint"], ["dark", "--blue"],
  ] as const)("%s 主题的 %s 在内容表面可读", (name, token) => {
    const t = theme(name);
    expect(contrast(t[token]!, t["--surface-panel"]!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t[token]!, t["--surface-raised"]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["light", "dark"] as const)("%s 主题 --text-faint 在 chrome/panel 上达到 4.5:1", (name) => {
    const t = theme(name);
    expect(contrast(t["--text-faint"]!, t["--surface-chrome"]!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--text-faint"]!, t["--surface-panel"]!)).toBeGreaterThanOrEqual(4.5);
  });

  it("侧栏品牌链接访问后和工作区名称继续使用主题文字色", () => {
    expect(shell).toMatch(/\.product-mark:visited\s*\{[^}]*color:\s*var\(--text\)/);
    expect(shell).toMatch(/\.workspace-switcher\s*\{[^}]*color:\s*var\(--text\)/);
    expect(shell).toMatch(/\.workspace-switcher strong\s*\{[^}]*color:\s*var\(--text\)/);
    expect(shell).toMatch(/\.shell-header \.profile-trigger\s*\{[^}]*color:\s*#6b44c8/);
    expect(shell).toMatch(/\.shell-header \.profile-trigger:hover\s*\{[^}]*color:\s*#6b44c8/);
    expect(shell).toMatch(/\.theme-dark \.shell-header \.profile-trigger\s*\{[^}]*color:\s*#cfb4ff/);
  });
});
