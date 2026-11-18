/** 组织架构图数据层（Round 78） */
import { describe, it, expect } from "vitest";
import { buildOrgTree, flattenVisible, orgStats, searchOrgTree, type OrgDepartment, type OrgMember } from "../src/client/lib/org-tree.ts";

const depts: OrgDepartment[] = [
  { id: "root", name: "研发部", parentId: null, sortOrder: 1, memberCount: 1 },
  { id: "child", name: "平台组", parentId: "root", sortOrder: 1, memberCount: 2 },
  { id: "grand", name: "基础设施组", parentId: "child", sortOrder: 1, memberCount: 0 },
  { id: "other", name: "市场部", parentId: null, sortOrder: 2, memberCount: 0 },
];
const members: OrgMember[] = [
  { id: "m1", name: "张三", username: "zhangsan", departmentId: "root", departmentName: "研发部", positionName: "研发总监" },
  { id: "m2", name: "李四", username: "lisi", departmentId: "child", departmentName: "平台组", positionName: "后端工程师" },
  { id: "m3", name: "王五", username: "wangwu", departmentId: "child", departmentName: "平台组", positionName: "后端工程师" },
];

describe("组织架构图", () => {
  it("组装树：根/子/孙 + 成员挂直属部门", () => {
    const tree = buildOrgTree(depts, members);
    expect(tree.map((n) => n.id)).toEqual(["root", "other"]);
    expect(tree[0]!.children.map((n) => n.id)).toEqual(["child"]);
    expect(tree[0]!.children[0]!.children.map((n) => n.id)).toEqual(["grand"]);
    expect(tree[0]!.members.map((m) => m.id)).toEqual(["m1"]);
    expect(tree[0]!.children[0]!.members).toHaveLength(2);
  });

  it("折叠后子级不出现", () => {
    const tree = buildOrgTree(depts, members);
    const expanded = flattenVisible(tree, new Set());
    expect(expanded.map((r) => r.node.id)).toContain("grand");
    const collapsed = flattenVisible(tree, new Set(["root"]));
    expect(collapsed.map((r) => r.node.id)).toEqual(["root", "other"]);
  });

  it("搜索命中成员名时保留祖先链", () => {
    const tree = buildOrgTree(depts, members);
    const visible = searchOrgTree(tree, "李四");
    expect(visible).not.toBeNull();
    expect([...visible!].sort()).toEqual(["child", "root"].sort());
    const none = searchOrgTree(tree, "不存在");
    expect(none?.size).toBe(0);
    expect(searchOrgTree(tree, "   ")).toBeNull();
  });

  it("统计部门/成员/职位/最深层级", () => {
    const tree = buildOrgTree(depts, members);
    expect(orgStats(tree)).toEqual({ departments: 4, members: 3, positions: 2, deepest: 3 });
  });
});
