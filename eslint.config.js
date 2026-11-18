/**
 * ESLint 扁平配置（ESLint 10）。
 *
 * 规则基座：@eslint/js recommended + typescript-eslint recommended（非类型检查版，
 * 避免对全仓库跑 type-aware 规则带来的构建耦合）。脚本（.mjs）补充 node + 浏览器全局；
 * TS/TSX 同时面向服务端（node）与客户端（浏览器）代码，两者全局都给。
 */
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-server/**",
      "docs-site/**",
      "node_modules/**",
      "coverage/**",
      ".cache/**",
      "playwright-report/**",
      "test-results/**",
      "drizzle/**",
      "docs/brand/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    // 存量代码校准（仓库首次引入 ESLint 时全量修平后的余量）：
    // - no-unused-vars：`_` 前缀的变量/参数/捕获为既有代码的约定忽略（typescript-eslint 官方推荐做法）
    // - no-control-regex：附件扫描需要匹配 \x00-\x1f 控制字符，属合法用途，豁免该规则
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-control-regex": "off",
    },
  },
);
