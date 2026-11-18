/**
 * Feronavi 平台自身的更新日志（产品级 What's New）。
 *
 * 注意：这里**不是**各项目的 release.notes —— 项目发布说明属于项目数据，
 * 在「项目 → 里程碑 → 版本」里查看。平台菜单下的更新日志只记录本产品版本。
 *
 * 每次发版在这里追加一条；页面按日期倒序展示。
 */
export type PlatformChangelogKind = "feature" | "design" | "performance" | "fix";

export interface PlatformChangelogEntry {
  version: string;
  date: string;
  title: string;
  summary: string;
  highlights: string[];
  kind: PlatformChangelogKind;
}

export const PLATFORM_CHANGELOG: PlatformChangelogEntry[] = [
  {
    version: "v6.18",
    date: "2026-10-31",
    title: "管理页面布局调整",
    kind: "design",
    summary: "整理角色权限、设置、系统自检、API 令牌与更新日志的布局和入口。",
    highlights: [
      "左侧选择角色，右侧查看和搜索权限",
      "设置分区增加导航，相关选项集中展示",
      "系统自检按运维、迁移和导出分区",
      "平台版本更新按时间排列",
    ],
  },
  {
    version: "v6.17",
    date: "2026-10-30",
    title: "大项目看板加载优化",
    kind: "performance",
    summary: "看板不再一次渲染整列几百张卡，避免大项目首屏卡顿。",
    highlights: [
      "分批加载各列工作项，保留整列总数",
      "点击「加载更多」继续查看",
      "首屏每列最多 25 张卡片，多工作流合并时最多 50 张",
      "减少屏幕外卡片的渲染，改善滚动流畅度",
    ],
  },
  {
    version: "v6.16",
    date: "2026-10-30",
    title: "邀请、附件与排期更新",
    kind: "feature",
    summary: "增加项目邀请角色、附件入口、拖动改期和看板筛选。",
    highlights: [
      "项目邀请支持多角色",
      "附件支持工作项、页面、里程碑和评论",
      "时间线条形支持拖拽改期",
      "看板支持优先级筛选和优先级泳道",
    ],
  },
  {
    version: "v6.15",
    date: "2026-10-30",
    title: "工作项编辑与公开需求收集",
    kind: "feature",
    summary: "工作项从看板/表格/项目都能新建并编辑，需求收集支持公开提交。",
    highlights: [
      "工作项新建/编辑入口与详情编辑",
      "里程碑/知识库评论",
      "项目设置与状态流转",
      "需求收集字段设计器 + 匿名公开页",
    ],
  },
  {
    version: "v6.14",
    date: "2026-10-28",
    title: "工作区布局调整",
    kind: "design",
    summary: "统一工作区的间距和滚动方式。",
    highlights: [
      "统一主工作区面板样式",
      "上下左右固定边距，滚动不贴边",
      "首页折线图改为内部滚动",
    ],
  },
];
