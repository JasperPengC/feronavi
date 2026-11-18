/**
 * 左树右内容布局（前端"该用左树右表"的落点）
 *
 * 知识库：左 = 文档树，右 = 正文；权限/字段等层级页同理。
 * 窄屏自动堆叠（树在上、内容在下），不产生横向滚动。
 */
import type { ReactNode } from "react";

export function TreeLayout({
  tree, children, treeWidth = 260, treeLabel, actions,
}: {
  tree: ReactNode;
  children: ReactNode;
  treeWidth?: number;
  treeLabel?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="ui-tree-layout" style={{ ["--tree-width" as string]: `${treeWidth}px` }}>
      <aside className="ui-tree-layout-side" aria-label={treeLabel}>
        {actions !== undefined && <div className="ui-tree-layout-actions">{actions}</div>}
        {tree}
      </aside>
      <section className="ui-tree-layout-main">{children}</section>
    </div>
  );
}
