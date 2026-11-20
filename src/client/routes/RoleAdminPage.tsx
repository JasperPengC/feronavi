import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiGet } from "../lib/api.ts";
import { rolesApi, type RoleAssignment, type ScopeType } from "../lib/roles-api.ts";
import { useActor } from "../lib/actor.ts";
import { t, useLocale } from "../i18n/index.ts";
import { PageGrid, PageHead } from "../components/Page.tsx";
import { Panel } from "../components/ui/Panel.tsx";
import { Select } from "../components/Select.tsx";
import { Checkbox } from "../components/Checkbox.tsx";
import { TreeLayout } from "../components/layout/TreeLayout.tsx";
import { PageTabs, TabPanel } from "../components/ui/PageTabs.tsx";
import { Button } from "../components/ui/Button.tsx";
import { confirmDialog } from "../components/Dialog.tsx";
import { StateBlock } from "../components/ui/StateBlock.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { toast } from "../components/ui/Toast.tsx";
import { Tree } from "../components/ui/Tree.tsx";
import { DraftNavigationGuard } from "../components/ui/DraftNavigationGuard.tsx";
import type { TreeNode } from "../components/ui/Tree.tsx";

interface MemberRow { id: string; username: string; name: string; status: string }

const emptyAssignment = { roleId: "", scopeType: "ORG" as ScopeType, scopeId: null as string | null };
const NEW_ROLE = "__new__";
const GROUP_BUILTIN = "__group_builtin__";
const GROUP_CUSTOM = "__group_custom__";
const CUSTOM_EMPTY_NODE = "__custom_empty__";
const UNAVAILABLE_PERMISSIONS: Record<string, string> = {
  "project:delete": "admin.permissionProjectDelete",
  "attachment:download_restricted": "admin.permissionAttachment",
  "telemetry:manage": "admin.permissionTelemetry",
  "api:read": "admin.permissionApiRead",
  "api:write": "admin.permissionApiWrite",
};
const permissionDescription = (permission: { key: string; description?: string | null }) =>
  UNAVAILABLE_PERMISSIONS[permission.key] ? t(UNAVAILABLE_PERMISSIONS[permission.key]!) : permission.description || permission.key;

export function RoleAdminPage() {
  useLocale();
  const actor = useActor();
  const qc = useQueryClient();
  const canManage = actor.permissions.includes("role:manage") && actor.dataScopes.some((s) => s.scopeType === "ORG");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [roleName, setRoleName] = useState("");
  const [roleSlug, setRoleSlug] = useState("");
  const [selectedPermissionKeys, setSelectedPermissionKeys] = useState<Set<string>>(new Set());
  const [memberId, setMemberId] = useState("");
  const [assignment, setAssignment] = useState(emptyAssignment);
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);
  const [editedAssignment, setEditedAssignment] = useState({ ...emptyAssignment });
  const [error, setError] = useState<string | null>(null);
  const [expandedRoleGroups, setExpandedRoleGroups] = useState<Set<string>>(() => new Set([GROUP_BUILTIN, GROUP_CUSTOM]));
  const [permQuery, setPermQuery] = useState("");
  const [section, setSection] = useState<"roles" | "assignments">("roles");
  const roleInitial = useRef<{ id: string; name: string; permissions: string } | null>(null);

  const rolesQuery = useQuery({
    queryKey: ["rbac", "roles"],
    queryFn: rolesApi.list,
    enabled: canManage,
  });
  const permissionsQuery = useQuery({
    queryKey: ["rbac", "permissions"],
    queryFn: rolesApi.permissions,
    enabled: canManage,
  });
  const membersQuery = useQuery({
    queryKey: ["rbac", "members"],
    queryFn: () => apiGet<{ members: MemberRow[] }>("/api/v1/members"),
    enabled: canManage,
  });
  const assignmentsQuery = useQuery({
    queryKey: ["rbac", "assignments", memberId],
    queryFn: () => rolesApi.assignments(memberId),
    enabled: canManage && !!memberId,
  });
  const scopesQuery = useQuery({
    queryKey: ["rbac", "scopes", assignment.scopeType],
    queryFn: () => rolesApi.scopeOptions(assignment.scopeType as "TEAM" | "PROJECT" | "DEPARTMENT"),
    enabled: canManage && assignment.scopeType !== "ORG",
  });
  const editScopesQuery = useQuery({
    queryKey: ["rbac", "scopes", "edit", editedAssignment.scopeType],
    queryFn: () => rolesApi.scopeOptions(editedAssignment.scopeType as "TEAM" | "PROJECT" | "DEPARTMENT"),
    enabled: canManage && !!editingAssignmentId && editedAssignment.scopeType !== "ORG",
  });

  const roleRows = rolesQuery.data?.roles ?? [];
  const permissionGroups = permissionsQuery.data?.groups ?? [];
  const memberRows = (membersQuery.data?.members ?? []).filter((m) => m.status === "ACTIVE");
  const isCreateMode = selectedRoleId === NEW_ROLE;
  const selectedRole = roleRows.find((role) => role.id === selectedRoleId) ?? null;
  const selectedRoleMissing = !!selectedRoleId && !isCreateMode && !selectedRole;
  const scopeOptions = scopesQuery.data?.scopes ?? [];
  const editScopeOptions = editScopesQuery.data?.scopes ?? [];

  useEffect(() => {
    if (!selectedRoleId && roleRows[0]) setSelectedRoleId(roleRows[0].id);
  }, [roleRows, selectedRoleId]);
  useEffect(() => {
    if (rolesQuery.isSuccess && roleRows.length === 0 && !selectedRoleId) setSelectedRoleId(NEW_ROLE);
  }, [rolesQuery.isSuccess, roleRows.length, selectedRoleId]);
  useEffect(() => {
    if (!selectedRoleId || isCreateMode) return;
    if (!selectedRole) {
      setRoleName("");
      setSelectedPermissionKeys(new Set());
      setError(t("rbac.roleMissing"));
    }
  }, [selectedRoleId, selectedRole, isCreateMode]);
  useEffect(() => {
    if (!selectedRole) return;
    if (roleInitial.current?.id === selectedRole.id) return;
    setRoleName(selectedRole.name);
    setSelectedPermissionKeys(new Set(selectedRole.permissionKeys));
    roleInitial.current = { id: selectedRole.id, name: selectedRole.name, permissions: [...selectedRole.permissionKeys].sort().join("|") };
  }, [selectedRole]);
  useEffect(() => {
    if (!memberId && memberRows[0]) setMemberId(memberRows[0].id);
  }, [memberRows, memberId]);
  useEffect(() => {
    if (assignment.scopeType === "ORG") {
      if (assignment.scopeId !== null) setAssignment((current) => ({ ...current, scopeId: null }));
    } else if (assignment.scopeId === null && scopeOptions[0]?.id) {
      const firstScopeId = scopeOptions[0].id;
      setAssignment((current) => ({ ...current, scopeId: firstScopeId }));
    }
  }, [assignment.scopeType, assignment.scopeId, scopeOptions]);
  useEffect(() => {
    if (!editingAssignmentId || !editedAssignment) return;
    if (editedAssignment.scopeType === "ORG") {
      if (editedAssignment.scopeId !== null) setEditedAssignment((current) => ({ ...current, scopeId: null }));
    } else if (editedAssignment.scopeId === null && editScopeOptions[0]?.id) {
      const firstScopeId = editScopeOptions[0].id;
      setEditedAssignment((current) => ({ ...current, scopeId: firstScopeId }));
    }
  }, [editingAssignmentId, editedAssignment, editScopeOptions]);

  const refreshRoles = async () => {
    await qc.invalidateQueries({ queryKey: ["rbac", "roles"] });
    await qc.invalidateQueries({ queryKey: ["actor"] });
  };
  const refreshAssignments = async () => {
    await qc.invalidateQueries({ queryKey: ["rbac", "assignments", memberId] });
    await qc.invalidateQueries({ queryKey: ["actor"] });
  };
  // 操作失败一律走浮动提示（不顶掉已填内容）；只有「所选角色已不存在」这种**持久状态**留在行内
  const handleError = (value: unknown) => toast.error(value instanceof ApiError ? value.message : t("rbac.operationFailed"));

  const selectedPermissionCount = selectedPermissionKeys.size;
  const groupedPermissions = useMemo(() => permissionGroups, [permissionGroups]);
  const filteredPermissionGroups = useMemo(() => {
    const q = permQuery.trim().toLowerCase();
    if (!q) return groupedPermissions;
    return groupedPermissions
      .map((g) => ({ ...g, permissions: g.permissions.filter((p) => p.key.toLowerCase().includes(q) || permissionDescription(p).toLowerCase().includes(q) || g.group.toLowerCase().includes(q)) }))
      .filter((g) => g.permissions.length > 0);
  }, [groupedPermissions, permQuery]);
  const totalPermissionCount = groupedPermissions.reduce((n, g) => n + g.permissions.length, 0);

  const roleDirty = isCreateMode ? !!(roleName || roleSlug || selectedPermissionKeys.size)
    : !!roleInitial.current && roleInitial.current.id === selectedRoleId && (roleName !== roleInitial.current.name || [...selectedPermissionKeys].sort().join("|") !== roleInitial.current.permissions);
  const assignmentDirty = !!assignment.roleId || !!editingAssignmentId;
  const canLeaveRole = async () => busyAction === null && (!roleDirty || await confirmDialog(t("flows.discardDraft")));
  if (!canManage) {
    return <div className="page"><PageHead title={t("nav.roles")} /><StateBlock kind="restricted" title={t("rbac.restricted")} description={t("rbac.restrictedHint")} /></div>;
  }
  if (rolesQuery.isLoading || permissionsQuery.isLoading || membersQuery.isLoading) {
    return <div className="page"><PageHead title={t("nav.roles")} /><StateBlock kind="loading" title={t("common.loading")} /></div>;
  }
  if (rolesQuery.isError || permissionsQuery.isError || membersQuery.isError) {
    return <div className="page"><PageHead title={t("nav.roles")} /><StateBlock kind="error" title={t("rbac.loadFailed")} action={() => { void rolesQuery.refetch(); void permissionsQuery.refetch(); void membersQuery.refetch(); }} actionLabel={t("common.reload")} /></div>;
  }

  async function saveRole() {
    if (busyAction) return;
    setError(null);
    setBusyAction("role-save");
    try {
      if (selectedRole && !selectedRole.isBuiltin && !selectedRole.isSystem) {
        const updated = await rolesApi.update(selectedRole.id, {
          name: roleName, permissionKeys: [...selectedPermissionKeys],
        });
        roleInitial.current = { id: updated.id, name: roleName, permissions: [...selectedPermissionKeys].sort().join("|") };
        setSelectedRoleId(updated.id);
      } else if (isCreateMode) {
        const created = await rolesApi.create({
          slug: roleSlug, name: roleName, permissionKeys: [...selectedPermissionKeys],
        });
        roleInitial.current = { id: created.id, name: roleName, permissions: [...selectedPermissionKeys].sort().join("|") };
        setSelectedRoleId(created.id);
        setRoleSlug("");
      }
      await refreshRoles();
    } catch (value) { handleError(value); }
    finally { setBusyAction(null); }
  }

  async function removeRole() {
    if (!selectedRole || selectedRole.isBuiltin || selectedRole.isSystem || !(await confirmDialog(t("rbac.deleteConfirm"), { danger: true }))) return;
    setError(null);
    setBusyAction("role-delete");
    try {
      await rolesApi.remove(selectedRole.id);
      setSelectedRoleId("");
      await refreshRoles();
    } catch (value) { handleError(value); }
    finally { setBusyAction(null); }
  }

  async function addAssignment() {
    if (!memberId || !assignment.roleId) return;
    setError(null);
    setBusyAction("assignment-create");
    try {
      await rolesApi.assign({ memberId, ...assignment });
      setAssignment({ ...emptyAssignment });
      await refreshAssignments();
    } catch (value) { handleError(value); }
    finally { setBusyAction(null); }
  }

  async function removeAssignment(id: string) {
    setError(null);
    setBusyAction(`assignment-delete:${id}`);
    try { await rolesApi.removeAssignment(id); await refreshAssignments(); }
    catch (value) { handleError(value); }
    finally { setBusyAction(null); }
  }

  async function startCreateRole() {
    if (!await canLeaveRole()) return;
    roleInitial.current = null;
    setSelectedRoleId(NEW_ROLE);
    setRoleName("");
    setRoleSlug("");
    setSelectedPermissionKeys(new Set());
    setError(null);
  }

  async function selectRoleNode(id: string) {
    // 分组不是角色：点分组 = 展开/收起（真实验收抓到的 bug：点分组曾报「所选角色已不存在」）
    if (id.startsWith("__group_")) {
      toggleRoleGroup(id);
      return;
    }
    if (id === CUSTOM_EMPTY_NODE || id === selectedRoleId) return;
    if (!await canLeaveRole()) return;
    roleInitial.current = null;
    setSelectedRoleId(id);
    setError(null);
  }

  function toggleRoleGroup(id: string) {
    setExpandedRoleGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startAssignmentEdit(item: RoleAssignment) {
    setEditingAssignmentId(item.id);
    setEditedAssignment({ roleId: item.roleId, scopeType: item.scopeType, scopeId: item.scopeId });
  }

  async function saveAssignmentEdit() {
    if (!editingAssignmentId) return;
    setError(null);
    setBusyAction("assignment-update");
    try {
      await rolesApi.updateAssignment(editingAssignmentId, editedAssignment);
      setEditingAssignmentId(null);
      setEditedAssignment({ ...emptyAssignment });
      await refreshAssignments();
    } catch (value) { handleError(value); }
    finally { setBusyAction(null); }
  }

  /* 角色树：内置 / 自定义 两组 —— 层级是真实的（内置不可改、自定义可改），不是为树而树。 */
  const builtinRoles = roleRows.filter((role) => role.isBuiltin || role.isSystem);
  const customRoles = roleRows.filter((role) => !role.isBuiltin && !role.isSystem);
  // 名称字段只有「新建」或「自定义角色」才可编辑：内置角色是只读的，别显示必填星号与"请输入"提示
  const roleEditable = isCreateMode || (!!selectedRole && !selectedRole.isBuiltin && !selectedRole.isSystem);
  const roleTreeNodes: TreeNode[] = [
    {
      id: GROUP_BUILTIN,
      label: t("rbac.builtinRoles"),
      children: builtinRoles.map((role) => ({
        id: role.id,
        label: (<span><strong>{role.name}</strong><span className="muted" style={{ marginLeft: 6, fontSize: "var(--text-xs)" }}>{role.key}</span></span>),
        extra: role.permissionKeys.length,
      })),
    },
    {
      id: GROUP_CUSTOM,
      label: t("rbac.customRoles"),
      children: customRoles.length > 0
        ? customRoles.map((role) => ({
            id: role.id,
            label: (<span><strong>{role.name}</strong><span className="muted" style={{ marginLeft: 6, fontSize: "var(--text-xs)" }}>{role.key}</span></span>),
            extra: role.permissionKeys.length,
          }))
        : [{ id: CUSTOM_EMPTY_NODE, label: t("rbac.noCustomRoles"), disabled: true }],
    },
  ];

  return (
    <div className="page workspace-page role-admin-page">
      <PageHead title={t("nav.roles")} />
      <PageTabs id="role-admin" label={t("nav.roles")} value={section} onChange={setSection} tabs={[
        { value: "roles", label: t("rbac.roleList") }, { value: "assignments", label: t("rbac.assignments") },
      ]} />
      <DraftNavigationGuard dirty={roleDirty || assignmentDirty} saving={busyAction !== null} message={t("flows.discardDraft")} />
      {error && <div className="alert alert-error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}

      {/* 左树右内容：左侧角色树，右侧所选角色的名称与权限矩阵 */}
      <TabPanel tabsId="role-admin" value="roles" activeValue={section} className="role-workspace">
      <TreeLayout
        treeLabel={t("rbac.roleList")}
        treeWidth={280}
        actions={<Button size="sm" onClick={startCreateRole}>{t("rbac.newRole")}</Button>}
        tree={(
          <Tree
            nodes={roleTreeNodes}
            ariaLabel={t("rbac.roleList")}
            emptyText={t("rbac.noRoles")}
            selectedId={selectedRole?.id ?? null}
            expandedIds={expandedRoleGroups}
            onSelect={selectRoleNode}
            onToggle={toggleRoleGroup}
          />
        )}
      >
        <Panel className="role-editor" title={isCreateMode ? t("rbac.createRole") : (selectedRole?.name ?? t("rbac.editRole"))}>
          {selectedRoleMissing && <StateBlock kind="error" title={t("rbac.roleMissing")} description={t("rbac.roleMissingHint")} action={() => void rolesQuery.refetch()} actionLabel={t("common.reload")} />}
          {(!selectedRoleMissing || isCreateMode) && <div className="role-editor-form">
            <div className={`role-details-fields${isCreateMode ? " is-creating" : ""}`}>
            {isCreateMode && (
              <TextInput
                label={t("rbac.slug")}
                hint={t("rbac.slugPlaceholder")}
                required
                value={roleSlug}
                onChange={(e) => setRoleSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              />
            )}
            <div className="role-field-row">
              <TextInput
                label={t("rbac.name")}
                hint={roleEditable ? t("rbac.namePlaceholder") : t("rbac.systemRole")}
                required={roleEditable}
                value={roleName}
                onChange={(e) => setRoleName(e.target.value)}
                disabled={!roleEditable || busyAction !== null}
              />
              {selectedRole && (
                <div className="role-key-meta">
                  <span className="mono tag">{selectedRole.key}</span>
                  {(selectedRole.isBuiltin || selectedRole.isSystem) && <span className="tag">{t("rbac.systemRole")}</span>}
                  <span className="muted" title={t("rbac.permissions")}>{selectedPermissionCount}</span>
                </div>
              )}
            </div>
            </div>
            <div className="perm-panel">
              <div className="perm-toolbar">
                <TextInput aria-label={t("rbac.searchPermissions")} placeholder={t("rbac.searchPermissions")}
                  value={permQuery} onChange={(e) => setPermQuery(e.target.value)} />
                <span className="muted">{t("rbac.selectedOf", { selected: String(selectedPermissionCount), total: String(totalPermissionCount) })}</span>
              </div>
              <div className="perm-groups" tabIndex={0} aria-label={t("rbac.permissions")} data-custom-scroll data-scrollbar-persistent>
                {filteredPermissionGroups.map((group) => (
                  <section key={group.group} className="perm-group">
                    <div className="perm-group-head">
                      <strong>{group.group}</strong>
                      <span className="muted">{group.permissions.length}</span>
                    </div>
                    <div className="perm-rows">
                      {group.permissions.map((permission) => (
                        <label key={permission.key} className="perm-row">
                          <Checkbox checked={selectedPermissionKeys.has(permission.key)} ariaLabel={permission.key} disabled={!!selectedRole?.isBuiltin || !!selectedRole?.isSystem || !!UNAVAILABLE_PERMISSIONS[permission.key] || busyAction !== null} onChange={(checked) => setSelectedPermissionKeys((current) => { const next = new Set(current); if (checked) next.add(permission.key); else next.delete(permission.key); return next; })} size="sm" />
                          <span className="perm-text">
                            <span>{permissionDescription(permission)}</span>
                            {UNAVAILABLE_PERMISSIONS[permission.key] && <span className="muted">{t("admin.permissionUnavailable")}</span>}
                            <code>{permission.key}</code>
                          </span>
                        </label>
                      ))}
                    </div>
                  </section>
                ))}
                {filteredPermissionGroups.length === 0 && <p className="muted" style={{ margin: 0 }}>{t("rbac.noPermissionMatch")}</p>}
              </div>
            </div>
            {roleEditable && <div className="role-editor-actions">
              {selectedRole && <Button variant="danger" disabled={busyAction !== null} onClick={() => void removeRole()}>{t("common.delete")}</Button>}
              <Button className="role-editor-save" variant="primary" disabled={busyAction !== null || !roleDirty || !roleName.trim() || (isCreateMode && !roleSlug.trim())} onClick={() => void saveRole()}>{busyAction === "role-save" ? t("common.saving") : selectedRole ? t("common.save") : t("common.create")}</Button>
            </div>}
          </div>
          }
        </Panel>
      </TreeLayout>
      </TabPanel>

      <TabPanel tabsId="role-admin" value="assignments" activeValue={section} className="role-assignments" >
        <PageGrid
          main={(
            <Panel title={t("rbac.assignments")}>
              <div style={{ display: "grid", gap: 10 }}>
                {memberRows.length === 0 && <p className="muted" style={{ margin: 0 }}>{t("rbac.noActiveMembers")}</p>}
                <Select label={t("rbac.member")} value={memberId} onChange={(id) => { if (busyAction) return; void (async () => { if (assignmentDirty && !await confirmDialog(t("flows.discardDraft"))) return; setMemberId(id); setAssignment({ ...emptyAssignment }); setEditingAssignmentId(null); })(); }} ariaLabel={t("rbac.member")} searchable options={memberRows.map((member) => ({ value: member.id, label: member.name || member.username, secondaryLabel: `@${member.username}` }))} placeholder={t("rbac.memberPlaceholder")} />
                <Select label={t("rbac.role")} value={assignment.roleId} onChange={(roleId) => setAssignment((current) => ({ ...current, roleId }))} ariaLabel={t("rbac.role")} options={roleRows.map((role) => ({ value: role.id, label: role.name }))} placeholder={t("rbac.rolePlaceholder")} />
                <Select label={t("rbac.scopeType")} value={assignment.scopeType} onChange={(scopeType) => setAssignment((current) => ({ ...current, scopeType: scopeType as ScopeType, scopeId: scopeType === "ORG" ? null : null }))} ariaLabel={t("rbac.scopeType")} options={[{ value: "ORG", label: "ORG" }, { value: "TEAM", label: "TEAM" }, { value: "PROJECT", label: "PROJECT" }, { value: "DEPARTMENT", label: "DEPARTMENT（部门及子部门项目）" }]} />
                {assignment.scopeType !== "ORG" && scopesQuery.isLoading && <StateBlock kind="loading" title={t("rbac.scopeLoading")} />}
                {assignment.scopeType !== "ORG" && scopesQuery.isError && <StateBlock kind="error" title={t("rbac.scopeLoadFailed")} action={() => void scopesQuery.refetch()} actionLabel={t("common.reload")} />}
                {assignment.scopeType !== "ORG" && scopesQuery.isSuccess && scopeOptions.length === 0 && <p className="muted">{t("rbac.noScopes")}</p>}
                {assignment.scopeType !== "ORG" && scopeOptions.length > 0 && <Select label={t("rbac.scope")} value={assignment.scopeId ?? ""} onChange={(scopeId) => setAssignment((current) => ({ ...current, scopeId }))} ariaLabel={t("rbac.scope")} options={scopeOptions.map((scope) => ({ value: scope.id, label: scope.name }))} placeholder={t("rbac.scopePlaceholder")} />}
                <Button variant="primary" disabled={busyAction !== null || !memberId || !assignment.roleId || (assignment.scopeType !== "ORG" && (!assignment.scopeId || scopesQuery.isLoading || scopesQuery.isError || scopeOptions.length === 0))} onClick={() => void addAssignment()}>{busyAction === "assignment-create" ? t("rbac.savingAssignment") : t("rbac.assign")}</Button>
              </div>
              <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
                {assignmentsQuery.isError && <StateBlock kind="error" title={t("rbac.assignmentsLoadFailed")} action={() => void assignmentsQuery.refetch()} actionLabel={t("common.reload")} />}
                {(assignmentsQuery.data?.assignments ?? []).map((item) => (
                  <div key={item.id} className="card" style={{ padding: 10, display: "grid", gap: 8 }}>
                    {editingAssignmentId === item.id ? (
                      <>
                        <Select label={t("rbac.role")} value={editedAssignment.roleId} onChange={(roleId) => setEditedAssignment((current) => ({ ...current, roleId }))} ariaLabel={t("rbac.role")} options={roleRows.map((role) => ({ value: role.id, label: role.name }))} />
                        <Select label={t("rbac.scopeType")} value={editedAssignment.scopeType} onChange={(scopeType) => setEditedAssignment((current) => ({ ...current, scopeType: scopeType as ScopeType, scopeId: null }))} ariaLabel={t("rbac.scopeType")} options={[{ value: "ORG", label: "ORG" }, { value: "TEAM", label: "TEAM" }, { value: "PROJECT", label: "PROJECT" }, { value: "DEPARTMENT", label: "DEPARTMENT（部门及子部门项目）" }]} />
                        {editedAssignment.scopeType !== "ORG" && editScopesQuery.isLoading && <StateBlock kind="loading" title={t("rbac.scopeLoading")} />}
                        {editedAssignment.scopeType !== "ORG" && editScopesQuery.isSuccess && editScopeOptions.length === 0 && <span className="muted">{t("rbac.noScopes")}</span>}
                        {editedAssignment.scopeType !== "ORG" && editScopeOptions.length > 0 && <Select label={t("rbac.scope")} value={editedAssignment.scopeId ?? ""} onChange={(scopeId) => setEditedAssignment((current) => ({ ...current, scopeId }))} ariaLabel={t("rbac.scope")} options={editScopeOptions.map((scope) => ({ value: scope.id, label: scope.name }))} placeholder={t("rbac.scopePlaceholder")} />}
                        {editScopesQuery.isError && <StateBlock kind="error" title={t("rbac.scopeLoadFailed")} action={() => void editScopesQuery.refetch()} actionLabel={t("common.reload")} />}
                        {editedAssignment.scopeType !== "ORG" && editScopesQuery.isSuccess && editScopeOptions.length === 0 && <span className="muted">{t("rbac.noScopes")}</span>}
                        <div style={{ display: "flex", gap: 6 }}><Button size="sm" variant="primary" disabled={busyAction !== null || !editedAssignment.roleId || (editedAssignment.scopeType !== "ORG" && (!editedAssignment.scopeId || editScopesQuery.isLoading || editScopesQuery.isError || editScopeOptions.length === 0))} onClick={() => void saveAssignmentEdit()}>{busyAction === "assignment-update" ? t("rbac.savingAssignment") : t("common.save")}</Button><Button size="sm" disabled={busyAction !== null} onClick={() => setEditingAssignmentId(null)}>{t("common.cancel")}</Button></div>
                      </>
                    ) : (
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span><strong>{item.roleName}</strong><span className="muted" style={{ display: "block" }}>{item.scopeType}{item.scopeName ? ` · ${item.scopeName}` : ""}</span></span><span style={{ display: "flex", gap: 6 }}><Button size="sm" disabled={busyAction !== null} onClick={() => startAssignmentEdit(item)}>{t("common.edit")}</Button><Button size="sm" variant="danger" disabled={busyAction !== null} onClick={async () => { if (await confirmDialog(t("rbac.removeAssignmentConfirm"), { danger: true })) await removeAssignment(item.id); }}>{busyAction === `assignment-delete:${item.id}` ? t("rbac.savingAssignment") : t("common.remove")}</Button></span></div>
                    )}
                  </div>
                ))}
                {memberId && assignmentsQuery.isLoading && <span className="muted">{t("common.loading")}</span>}
                {memberId && !assignmentsQuery.isLoading && (assignmentsQuery.data?.assignments ?? []).length === 0 && <span className="muted">{t("rbac.noAssignments")}</span>}
              </div>
            </Panel>
          )}
          side={(
            <Panel title={t("rbac.currentAccess")}>
              <p style={{ marginTop: 0 }}><strong>{actor.name}</strong> <span className="muted">{actor.username}</span></p>
              <p className="muted" style={{ marginBottom: 6 }}>{t("rbac.grants")}</p>
              <ul style={{ marginTop: 0, paddingLeft: 18 }}>{actor.dataScopes.map((scope, index) => <li key={`${scope.scopeType}:${scope.scopeId}:${index}`}><code>{scope.scopeType}</code>{scope.scopeId ? ` · ${scope.scopeId}` : ""}</li>)}</ul>
              <p className="muted" style={{ marginBottom: 6 }}>{t("rbac.permissions")}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{actor.permissions.map((permission) => <code key={permission} className="status-pill">{permission}</code>)}</div>
            </Panel>
          )}
        />
      </TabPanel>
    </div>
  );
}
