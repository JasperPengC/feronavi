/**
 * 组织架构图数据层（Round 78 · 超越参考应用的静态部门页）
 *
 * 纯函数：部门树组装、可见行展开（折叠）、搜索过滤（命中部门名/成员名，并保留祖先链）、统计。
 * 不依赖 DOM，便于单测；成员来自 /members（含 departmentId/positionName）。
 */
export interface OrgDepartment {
  id: string; name: string; parentId: string | null; sortOrder: number; memberCount: number;
}
export interface OrgMember {
  id: string; name: string; username: string;
  departmentId: string | null; departmentName: string | null;
  positionId?: string | null; positionName: string | null;
}
export interface OrgNode {
  id: string; name: string; parentId: string | null; sortOrder: number;
  children: OrgNode[]; members: OrgMember[];
}
export interface OrgStats { departments: number; members: number; positions: number; deepest: number }

/** 组装森林（同层按 sortOrder、名称排序；成员挂到直属部门） */
export function buildOrgTree(departments: OrgDepartment[], members: OrgMember[]): OrgNode[] {
  const nodes = new Map<string, OrgNode>();
  for (const d of departments) {
    nodes.set(d.id, { id: d.id, name: d.name, parentId: d.parentId, sortOrder: d.sortOrder, children: [], members: [] });
  }
  for (const m of members) {
    if (!m.departmentId) continue;
    nodes.get(m.departmentId)?.members.push(m);
  }
  const roots: OrgNode[] = [];
  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) nodes.get(node.parentId)!.children.push(node);
    else roots.push(node);
  }
  const bySort = (a: OrgNode, b: OrgNode) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  const sortRec = (list: OrgNode[]) => { list.sort(bySort); list.forEach((n) => sortRec(n.children)); };
  sortRec(roots);
  return roots;
}

/** 展开为可见行（折叠节点只保留自身，不深入子级） */
export function flattenVisible(nodes: OrgNode[], collapsed: ReadonlySet<string>, depth = 0): { node: OrgNode; depth: number }[] {
  const out: { node: OrgNode; depth: number }[] = [];
  for (const node of nodes) {
    out.push({ node, depth });
    if (!collapsed.has(node.id) && node.children.length > 0) out.push(...flattenVisible(node.children, collapsed, depth + 1));
  }
  return out;
}

/** 搜索：返回「命中节点 + 其祖先」的可见集合；空查询返回 null（表示不过滤） */
export function searchOrgTree(nodes: OrgNode[], query: string): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const visible = new Set<string>();
  const matches = (node: OrgNode): boolean =>
    node.name.toLowerCase().includes(q) || node.members.some((m) => m.name.toLowerCase().includes(q) || m.username.toLowerCase().includes(q));
  const walk = (node: OrgNode, ancestors: string[]): boolean => {
    const self = matches(node);
    let childHit = false;
    for (const child of node.children) if (walk(child, [...ancestors, node.id])) childHit = true;
    if (self || childHit) {
      visible.add(node.id);
      for (const a of ancestors) visible.add(a);
      return true;
    }
    return false;
  };
  for (const root of nodes) walk(root, []);
  return visible;
}

/** 统计（部门含全部层级；成员按已挂载；positions = 有职位的人数维度去重职位名） */
export function orgStats(nodes: OrgNode[]): OrgStats {
  let departments = 0, members = 0, deepest = 0;
  const positions = new Set<string>();
  const walk = (node: OrgNode, depth: number) => {
    departments += 1;
    members += node.members.length;
    deepest = Math.max(deepest, depth + 1);
    for (const m of node.members) if (m.positionName) positions.add(m.positionName);
    for (const child of node.children) walk(child, depth + 1);
  };
  for (const node of nodes) walk(node, 0);
  return { departments, members, positions: positions.size, deepest };
}
