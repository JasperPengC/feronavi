/**
 * 交互式组织架构图（Round 78 · 超越参考应用的静态部门页）
 *
 * 树形部门 + 直属成员 + 职位；支持搜索（部门/成员，保留祖先链）、折叠/展开、点击节点看详情。
 * 数据全部来自真实 /departments /members（成员含部门/职位），不画假节点。
 */
import { useMemo, useState } from "react";
import { t, useLocale } from "../i18n/index.ts";
import { TextInput } from "./ui/TextInput.tsx";
import { Button } from "./ui/Button.tsx";
import { Panel } from "./ui/Panel.tsx";
import { Icon } from "./Icon.tsx";
import { buildOrgTree, flattenVisible, orgStats, searchOrgTree, type OrgDepartment, type OrgMember, type OrgNode } from "../lib/org-tree.ts";

export function OrganizationChart({ departments, members }: { departments: OrgDepartment[]; members: OrgMember[] }) {
  useLocale();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const tree = useMemo(() => buildOrgTree(departments, members), [departments, members]);
  const visible = useMemo(() => searchOrgTree(tree, query), [tree, query]);
  const rows = useMemo(() => flattenVisible(tree, collapsed), [tree, collapsed]);
  const stats = useMemo(() => orgStats(tree), [tree]);
  const shown = visible ? rows.filter((r) => visible.has(r.node.id)) : rows;
  const selectedNode = (() => {
    const find = (nodes: OrgNode[]): OrgNode | null => {
      for (const n of nodes) {
        if (n.id === selected) return n;
        const hit = find(n.children);
        if (hit) return hit;
      }
      return null;
    };
    return selected ? find(tree) : null;
  })();
  const toggle = (id: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="org-chart">
      <div className="org-chart-toolbar">
        <TextInput aria-label={t("org.searchPlaceholder")} placeholder={t("org.searchPlaceholder")} value={query}
          onChange={(e) => setQuery(e.target.value)} />
        <Button size="sm" onClick={() => setCollapsed(new Set())}>{t("org.expandAll")}</Button>
        <Button size="sm" onClick={() => setCollapsed(new Set(flattenVisible(tree, new Set()).filter((r) => r.node.children.length > 0).map((r) => r.node.id)))}>{t("org.collapseAll")}</Button>
        <span className="org-chart-stats">
          <span>{t("org.statDepartments")} <strong>{stats.departments}</strong></span>
          <span>{t("org.statMembers")} <strong>{stats.members}</strong></span>
          <span>{t("org.statPositions")} <strong>{stats.positions}</strong></span>
          <span>{t("org.statDepth")} <strong>{stats.deepest}</strong></span>
        </span>
      </div>

      <div className="org-chart-layout">
        <Panel className="org-chart-canvas">
          {shown.length === 0 && <p className="muted">{t("org.noSearchResult")}</p>}
          <ul className="org-chart-tree" role="tree" aria-label={t("org.chartTitle")}>
            {shown.map(({ node, depth }) => (
              <li key={node.id} role="treeitem" aria-expanded={node.children.length > 0 ? !collapsed.has(node.id) : undefined}
                aria-selected={selected === node.id}>
                <div className={`org-chart-node${selected === node.id ? " is-selected" : ""}`} style={{ marginLeft: depth * 22 }}
                  onClick={() => setSelected(node.id)}>
                  {node.children.length > 0 ? (
                    <button type="button" className="org-chart-toggle" aria-label={collapsed.has(node.id) ? t("org.expand") : t("org.collapse")}
                      onClick={(e) => { e.stopPropagation(); toggle(node.id); }}>
                      <Icon name={collapsed.has(node.id) ? "chevron-right" : "chevron-down"} size={13} />
                    </button>
                  ) : <span className="org-chart-leaf" aria-hidden="true" />}
                  <span className="org-chart-mark" aria-hidden="true"><Icon name="users" size={14} /></span>
                  <span className="org-chart-name">{node.name}</span>
                  <span className="tag">{node.members.length}</span>
                  <span className="org-chart-member-chips">
                    {node.members.slice(0, 3).map((m) => <span key={m.id} className="tag" title={m.positionName ?? ""}>{m.name}</span>)}
                    {node.members.length > 3 && <span className="muted">+{node.members.length - 3}</span>}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel className="org-chart-detail">
          {!selectedNode && <p className="muted" style={{ fontSize: "var(--text-sm)" }}>{t("org.selectNodeHint")}</p>}
          {selectedNode && (
            <>
              <strong>{selectedNode.name}</strong>
              <p className="muted" style={{ margin: "4px 0 10px", fontSize: "var(--text-xs)" }}>
                {t("org.childDepartments")} {selectedNode.children.length} · {t("org.directMembers")} {selectedNode.members.length}
              </p>
              {selectedNode.members.length === 0 && <p className="muted" style={{ fontSize: "var(--text-sm)" }}>{t("org.noMembers")}</p>}
              <ul className="org-chart-members">
                {selectedNode.members.map((m) => (
                  <li key={m.id}>
                    <span className="row-avatar" aria-hidden="true">{(m.name || m.username).slice(0, 1)}</span>
                    <span style={{ flex: 1 }}>{m.name}<span className="muted"> @{m.username}</span></span>
                    <span className="tag">{m.positionName ?? t("org.noPosition")}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
