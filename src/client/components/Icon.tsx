/**
 * 自写图标集（外壳重做第 3 轮；Round 24 按原型与语义**全面校正**）
 *
 * 为什么自写而不引图标库：本仓一贯自写必要实现（PDF 写入器、XLSX 读取器都是自写），
 * 图标只有三十来个、且是纯静态路径 —— 引一个依赖只为几十个 SVG 不划算，也会让 CSP/体积多一份变量。
 *
 * 约定（这三条是"成体系"的关键，缺一个就会看起来像拼凑）：
 *  1. **统一描边风格**：`stroke="currentColor"` + 1.6 线宽 + 圆角端点，不用填充；
 *  2. **统一画布 + 统一光学尺寸**：24×24 viewBox；每个图标再按实测包围盒归一到「最大边 18、居中」，
 *     线宽同步补偿 —— 否则同一排图标会视觉上大大小小（用户 Round 25 反馈）；
 *  3. **一律 `aria-hidden`** —— 图标本身不承载语义，语义由按钮的 `aria-label` 承担
 *     （这条很关键：读屏用户听到的是"搜索"，而不是"图标"）。
 *
 * ⚠️ **图标语义（Round 24 校正，用户要求"所有图标纠正为正确的"）**：
 *  · 与设计原型重叠的页面**采用原型的符号**：总览=grid、项目=layers、工作项=check、
 *    计划=calendar、知识库=book、成员=users、看板=grid、更多筛选=filter、新建=plus、更多=more；
 *  · 原型没有的页面按实体语义补：里程碑=flag、时间线=timeline、表格=table、工作流=workflow、
 *    字段=sliders、想法=spark、洞察=chart、导入=file、项目集=package、系统自检=system、
 *    空态=inbox、提示=info、时间=clock；
 *  · 不再用"凑合"的图标（例如此前项目内导航**全部**用 list、空态一律用 target）。
 */
import type { CSSProperties } from "react";

export type IconName =
  | "search" | "bell" | "sun" | "moon" | "monitor" | "globe" | "logout" | "user"
  | "menu" | "chevron-down" | "check" | "x" | "plus" | "calendar" | "book" | "list" | "chevron-left" | "chevron-right"
  /* 侧栏导航（外壳重做第 4 轮） */
  | "home" | "target" | "folder" | "layers" | "megaphone" | "key" | "shield" | "settings" | "users"
  /* Round 24：原型符号 + 实体/动作语义补全 */
  | "grid" | "arrow" | "command" | "filter" | "more" | "clock" | "file" | "sliders" | "spark" | "system"
  | "flag" | "table" | "timeline" | "chart" | "workflow" | "inbox" | "info" | "package"
  | "refresh" | "trash" | "archive" | "upload" | "download" | "pencil" | "send" | "link"
  | "activity" | "audit";

const PATHS: Record<IconName, React.ReactNode> = {
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /></>,
  bell: <><path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5 1.5 5H4.5S6 13 6 9z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" /></>,
  moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />,
  monitor: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
  logout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5M5 12h9" /></>,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  "chevron-down": <path d="M6 9l6 6 6-6" />,
  "chevron-left": <path d="M15 6l-6 6 6 6" />,
  "chevron-right": <path d="M9 6l6 6-6 6" />,
  check: <path d="M5 13l4 4 10-10" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 11h18" /></>,
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5z" /><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20" /></>,
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  home: <><path d="M4 11l8-7 8 7" /><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  layers: <><path d="M12 3l8 4.5-8 4.5-8-4.5z" /><path d="M4 12l8 4.5 8-4.5M4 16.5L12 21l8-4.5" /></>,
  megaphone: <><path d="M4 10v4l12 5V5z" /><path d="M16 8a3 3 0 0 1 0 8" /></>,
  key: <><circle cx="8" cy="12" r="4" /><path d="M12 12h9M18 12v3M15 12v2" /></>,
  shield: <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" />,
  /* 齿轮（真正的齿形；此前的 circle+8 射线与主题 sun 图标几乎一样，语义混淆） */
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" /><path d="M16 8.5a3 3 0 0 1 0 5M18 20c0-2 0-3.2-1-4.4" /></>,

  /* ── 原型符号（对齐 tests/feronavi-product 的 symbol 定义）── */
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  command: <path d="M18 9a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12Z" />,
  filter: <path d="M4 5h16M7 12h10M10 19h4" />,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
  sliders: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="11" cy="18" r="2" /></>,
  spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></>,
  system: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,

  /* ── 原型没有的页面：按实体/动作语义补（同一套描边约定）── */
  flag: <path d="M5 21V4a1 1 0 0 1 1-1h11l-2.5 5L17 13H6" />,
  table: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 10v10M15 10v10" /></>,
  timeline: <><path d="M3 12h18" /><circle cx="7" cy="12" r="2" /><circle cx="13" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></>,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  workflow: <><rect x="3" y="4" width="6" height="5" rx="1.5" /><rect x="15" y="15" width="6" height="5" rx="1.5" /><path d="M9 6.5h4a2 2 0 0 1 2 2V15" /></>,
  inbox: <><path d="M4 13h4l1.5 3h5L16 13h4" /><path d="M5 5h14l2 8v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  package: <><path d="M12 3 20 7v10l-8 4-8-4V7z" /><path d="M4 7l8 4 8-4M12 11v10" /></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2.5 6.4" /><path d="M20 5v6h-6" /></>,
  trash: <><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /><path d="M10 11v6M14 11v6" /></>,
  archive: <><rect x="3" y="4" width="18" height="5" rx="1.5" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" /><path d="M10 13h4" /></>,
  upload: <><path d="M12 16V4M8 8l4-4 4 4" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>,
  download: <><path d="M12 4v12M8 12l4 4 4-4" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>,
  pencil: <><path d="M4 20l4-1L20 7l-3-3L5 16z" /><path d="M14 6l3 3" /></>,
  send: <><path d="M21 3 10 14" /><path d="M21 3 14 21l-4-7-7-4z" /></>,
  link: <><path d="M9 15l6-6" /><path d="M10 6l1-1a4 4 0 0 1 6 6l-1 1M14 18l-1 1a4 4 0 0 1-6-6l1-1" /></>,
  activity: <path d="M3 12h4l2.5-6 4 12 2.5-6h5" />,
  /* 审计日志：剪贴板 + 勾（合规记录） */
  audit: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 3h6v3H9z" /><path d="M8.5 12l2 2 4-4" /></>,
};

/** 全部图标名（审计脚本/测试用；顺序即 PATHS 定义顺序） */
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

/**
 * 光学归一（Round 25，用户反馈"图标大大小小不一致"）
 *
 * 每个图标原始路径的可视包围盒差异很大（实测 24 网格内 max 边：more=16×2、key=17×8、
 * check=14×10、settings=22×22、sun=20×20……）。所以不能只统一画布 24，还要**统一可视尺寸**：
 *  · 以「可视包围盒最大边 = 18」为基准做等比缩放（保留各自长宽比）；
 *  · 平移让包围盒中心落在 (12,12)；
 *  · 同时把组内线宽设为 1.6/s —— 否则缩放后线宽视觉粗细也会不一致。
 * 数值由真实浏览器 getBBox 量测后生成（scripts 审计脚本），不是手估。
 */
const NORM: Record<IconName, { s: number; tx: number; ty: number }> = {
  "search": { s: 1.1250, tx: -1.5000, ty: -1.5000 },
  "bell": { s: 0.9474, tx: 0.6316, ty: 0.1579 },
  "sun": { s: 0.9000, tx: 1.2000, ty: 1.2000 },
  "moon": { s: 1.0794, tx: -0.5879, ty: -1.3176 },
  "monitor": { s: 1.0000, tx: 0.0000, ty: 0.0000 },
  "globe": { s: 1.0000, tx: 0.0000, ty: 0.0000 },
  "logout": { s: 1.1250, tx: -2.0625, ty: -1.5000 },
  "user": { s: 1.1613, tx: -1.9355, ty: -2.2258 },
  "menu": { s: 1.1250, tx: -1.5000, ty: -1.5000 },
  "chevron-down": { s: 1.5000, tx: -6.0000, ty: -6.0000 },
  "chevron-left": { s: 1.5000, tx: -6.0000, ty: -6.0000 },
  "chevron-right": { s: 1.5000, tx: -6.0000, ty: -6.0000 },
  "check": { s: 1.2857, tx: -3.4286, ty: -3.4286 },
  "x": { s: 1.5000, tx: -6.0000, ty: -6.0000 },
  "plus": { s: 1.2857, tx: -3.4286, ty: -3.4286 },
  "calendar": { s: 1.0000, tx: 0.0000, ty: 0.0000 },
  "book": { s: 1.0000, tx: 0.0000, ty: 0.0000 },
  "list": { s: 1.0286, tx: -0.6000, ty: -0.3429 },
  "home": { s: 1.1250, tx: -1.5000, ty: -1.5000 },
  "target": { s: 1.1250, tx: -1.5000, ty: -1.5000 },
  "folder": { s: 1.0000, tx: 0.0000, ty: 0.0000 },
  "layers": { s: 1.0000, tx: 0.0000, ty: 0.0000 },
  "megaphone": { s: 1.1250, tx: -1.5000, ty: -1.5000 },
  "key": { s: 1.0588, tx: -1.2353, ty: -0.7059 },
  "shield": { s: 1.0000, tx: 0.0000, ty: 0.0000 },
  "settings": { s: 0.8182, tx: 2.1818, ty: 2.1818 },
  "users": { s: 1.2000, tx: -0.6000, ty: -3.0000 },
  "grid": { s: 1.0000, tx: 0.0000, ty: 0.0000 },
  "arrow": { s: 1.2857, tx: -3.4286, ty: -3.4286 },
  "command": { s: 1.0000, tx: 0.0000, ty: 0.0000 },
  "filter": { s: 1.1250, tx: -1.5000, ty: -1.5000 },
  "more": { s: 1.1250, tx: -1.5000, ty: -1.5000 },
  "clock": { s: 1.0000, tx: 0.0000, ty: 0.0000 },
  "file": { s: 1.0000, tx: -0.5000, ty: 0.0000 },
  "sliders": { s: 1.1250, tx: -1.5000, ty: -1.5000 },
  "spark": { s: 0.9474, tx: -0.7895, ty: 0.1579 },
  "system": { s: 1.0000, tx: 0.0000, ty: -0.5000 },
  "flag": { s: 1.0000, tx: 1.0000, ty: 0.0000 },
  "table": { s: 1.0000, tx: 0.0000, ty: 0.0000 },
  "timeline": { s: 1.0000, tx: 0.0000, ty: 0.0000 },
  "chart": { s: 0.9000, tx: 1.2000, ty: 1.2000 },
  "workflow": { s: 1.0000, tx: 0.0000, ty: 0.0000 },
  "inbox": { s: 1.0000, tx: 0.0000, ty: 0.0000 },
  "info": { s: 1.0000, tx: 0.0000, ty: 0.0000 },
  "package": { s: 1.0000, tx: 0.0000, ty: 0.0000 },
  "refresh": { s: 1.1250, tx: -1.5113, ty: -1.0174 },
  "trash": { s: 1.1250, tx: -1.5000, ty: -2.0625 },
  "archive": { s: 1.0000, tx: 0.0000, ty: 0.0000 },
  "upload": { s: 1.1250, tx: -1.5000, ty: -1.5000 },
  "download": { s: 1.1250, tx: -1.5000, ty: -1.5000 },
  "pencil": { s: 1.1250, tx: -1.5000, ty: -1.5000 },
  "send": { s: 1.0000, tx: 0.0000, ty: 0.0000 },
  "link": { s: 1.0919, tx: -1.1028, ty: -1.1028 },
  "activity": { s: 1.0000, tx: 0.0000, ty: 0.0000 },
  "audit": { s: 1.0000, tx: 0.0000, ty: 0.0000 },
};

export function Icon({ name, size = 16, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: "none", ...style }}
    >
      <g
        transform={`translate(${NORM[name].tx} ${NORM[name].ty}) scale(${NORM[name].s})`}
        strokeWidth={+(1.6 / NORM[name].s).toFixed(3)}
      >
        {PATHS[name]}
      </g>
    </svg>
  );
}
