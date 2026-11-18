/**
 * 树控件基元（前端树级控件统一化 第 1 步）
 *
 * 为什么需要它：知识库的文档树此前是**页面内手写**的（.wiki-tree-panel + 递归 div），
 * 其它"层级数据"页面（权限、自定义字段分类）则完全没有树 —— 该用左树右内容的地方没有用。
 *
 * a11y（不只是好看）：`role="tree"` / `role="treeitem"` / `aria-expanded` /
 * `aria-selected` / `aria-level`，并支持 **↑↓ 移动、←→ 收放、Enter 选中**。
 * **不依赖颜色表达层级**（缩进 + 展开箭头 + aria-level 三条线索）。
 */
import { useCallback, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Icon } from "../Icon.tsx";
import { t } from "../../i18n/index.ts";

export interface TreeNode {
  id: string;
  label: ReactNode;
  children?: TreeNode[];
  /** 右侧附加内容（如计数、状态药丸） */
  extra?: ReactNode;
  disabled?: boolean;
}

export function Tree({
  nodes, selectedId, expandedIds, onSelect, onToggle, ariaLabel, emptyText,
}: {
  nodes: TreeNode[];
  selectedId?: string | null;
  expandedIds?: Set<string>;
  onSelect?: (id: string) => void;
  onToggle?: (id: string) => void;
  ariaLabel?: string;
  emptyText?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  /** 把可见节点摊平，供键盘上下移动（只走**已展开**的分支） */
  const flat = useCallback((): { id: string; parentId?: string; hasChildren: boolean; expanded: boolean }[] => {
    const out: { id: string; parentId?: string; hasChildren: boolean; expanded: boolean }[] = [];
    const walk = (list: TreeNode[], parentId?: string) => {
      for (const n of list) {
        if (n.disabled) continue;
        const hasChildren = !!n.children?.length;
        const expanded = !!expandedIds?.has(n.id);
        out.push({ id: n.id, parentId, hasChildren, expanded });
        if (hasChildren && expanded) walk(n.children!, n.id);
      }
    };
    walk(nodes);
    return out;
  }, [nodes, expandedIds]);
  const visibleNodes = flat();
  const tabStop = visibleNodes.find((node) => node.id === focusedId)?.id
    ?? visibleNodes.find((node) => node.id === selectedId)?.id ?? visibleNodes[0]?.id;
  const focusNode = (id: string | undefined) => {
    if (!id) return;
    setFocusedId(id);
    const element = [...rootRef.current?.querySelectorAll<HTMLElement>("[data-tree-id]") ?? []].find((node) => node.dataset.treeId === id);
    element?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = flat();
    if (list.length === 0) return;
    const targetId = (e.target as HTMLElement).closest<HTMLElement>("[data-tree-id]")?.dataset.treeId;
    const cur = list.findIndex((x) => x.id === (targetId ?? tabStop));
    const move = (dir: 1 | -1) => {
      const next = list[Math.min(list.length - 1, Math.max(0, (cur < 0 ? 0 : cur) + dir))];
      focusNode(next?.id);
    };
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); move(1); break;
      case "ArrowUp": e.preventDefault(); move(-1); break;
      case "Home": e.preventDefault(); focusNode(list[0]?.id); break;
      case "End": e.preventDefault(); focusNode(list.at(-1)?.id); break;
      case "ArrowRight": {
        e.preventDefault();
        const node = list[cur];
        if (node?.hasChildren && !node.expanded) onToggle?.(node.id);
        else if (node?.hasChildren) focusNode(list[cur + 1]?.id);
        break;
      }
      case "ArrowLeft": {
        e.preventDefault();
        const node = list[cur];
        if (node?.hasChildren && node.expanded) onToggle?.(node.id);
        else focusNode(node?.parentId);
        break;
      }
      case "Enter": case " ": e.preventDefault(); if (cur >= 0) onSelect?.(list[cur]!.id); break;
      default: break;
    }
  };

  const renderNodes = (list: TreeNode[], level: number): ReactNode => (
    <ul role={level === 0 ? "tree" : "group"} aria-label={level === 0 ? ariaLabel : undefined}
      style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {list.map((n) => {
        const hasChildren = !!n.children?.length;
        const expanded = !!expandedIds?.has(n.id);
        const selected = selectedId === n.id;
        return (
          <li key={n.id} role="treeitem" aria-level={level + 1} aria-selected={selected}
            aria-expanded={hasChildren ? expanded : undefined} tabIndex={!n.disabled && tabStop === n.id ? 0 : -1}
            aria-disabled={n.disabled || undefined} data-tree-id={n.id}
            onFocus={(event) => { event.stopPropagation(); setFocusedId(n.id); }}
            data-selected={selected ? "true" : "false"} className="ui-tree-item"
            style={{ paddingLeft: level * 14 }}
            // 必须阻止冒泡：嵌套树里点叶子会冒泡到祖先分组行，导致「选角色同时把分组折叠了」
            // —— 这是角色权限页真实点击验收抓到的 bug，不是理论问题。
            onClick={(e) => { e.stopPropagation(); if (!n.disabled) { focusNode(n.id); onSelect?.(n.id); } }}>
            <span className="ui-tree-row">
              {hasChildren ? (
                <button type="button" className="ui-tree-toggle"
                  aria-label={t(expanded ? "tree.collapse" : "tree.expand")} tabIndex={-1} disabled={n.disabled}
                  onClick={(e) => { e.stopPropagation(); onToggle?.(n.id); }}>
                  <Icon name={expanded ? "chevron-down" : "chevron-right"} size={12} />
                </button>
              ) : (
                <span className="ui-tree-toggle" aria-hidden="true" />
              )}
              <span className="ui-tree-label">{n.label}</span>
              {n.extra !== undefined && <span className="ui-tree-extra">{n.extra}</span>}
            </span>
            {hasChildren && expanded && renderNodes(n.children!, level + 1)}
          </li>
        );
      })}
    </ul>
  );

  if (nodes.length === 0) {
    return <div className="ui-tree-empty">{emptyText ?? "—"}</div>;
  }
  return (
    <div ref={rootRef} className="ui-tree" onKeyDown={onKeyDown}>{renderNodes(nodes, 0)}</div>
  );
}
