import { TableScroll } from "../components/ui/TableScroll.tsx";
/** 成员目录、账号创建、邀请和团队管理；负荷以真实工作项计数展示。 */
import { useState } from "react";
import { PageTabs, TabPanel } from "../components/ui/PageTabs.tsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { t } from "../i18n/index.ts";
import { apiGet, apiPatch, ApiError } from "../lib/api.ts";
import { useSettingsDraft } from "../components/settings/SettingsDraft.tsx";
import { PageHead } from "../components/Page.tsx";
import { InfoTip } from "../components/ui/InfoTip.tsx";
import { Button } from "../components/ui/Button.tsx";
import { MetricCard } from "../components/ui/MetricCard.tsx";
import { Panel } from "../components/ui/Panel.tsx";
import { StateBlock } from "../components/ui/StateBlock.tsx";
import { TeamPanel } from "../components/TeamPanel.tsx";
import { MemberPermissionsDrawer } from "../components/MemberPermissionsDrawer.tsx";
import { useCan } from "../lib/actor.ts";
import { InvitePanel } from "../components/InvitePanel.tsx";
import { CreateMemberDrawer } from "../components/CreateMemberDrawer.tsx";
import { Icon } from "../components/Icon.tsx";
import { Drawer } from "../components/ui/Drawer.tsx";
import { Select } from "../components/Select.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";

interface MemberRow {
  id: string; username: string; name: string; email: string;
  status: "ACTIVE" | "DISABLED"; timezone: string | null; locale: string | null;
  createdAt: string; load: number;
  departmentId: string | null; departmentName: string | null;
  positionId: string | null; positionName: string | null;
  roles: { key: string; name: string; scopeType: string }[];
}

export function MembersPage() {
  const qc = useQueryClient();
  const canManage = useCan("member:manage");
  const canCreate = useCan("member:invite");
  const [createOpen, setCreateOpen] = useState(false);
  const [permTarget, setPermTarget] = useState<{ id: string; name: string } | null>(null);
  const [orgTarget, setOrgTarget] = useState<{ id: string; name: string; departmentId: string; positionId: string } | null>(null);
  const [orgBusy, setOrgBusy] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);
  const orgDraft = useSettingsDraft(!!orgTarget, orgTarget, orgBusy);
  const closeOrg = () => void orgDraft.leave(() => { setOrgTarget(null); setOrgError(null); });
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [memberTab, setMemberTab] = useState<"directory" | "invites" | "teams">("directory");
  const departmentOptions = useQuery({
    queryKey: ["departments"],
    queryFn: () => apiGet<{ departments: { id: string; name: string }[] }>("/api/v1/departments").then((r) => r.departments),
  });
  const q = useQuery({
    queryKey: ["members"],
    queryFn: () => apiGet<{ members: MemberRow[]; metric: string }>("/api/v1/members"),
  });
  const rows = q.data?.members ?? [];
  const departments = useQuery({
    queryKey: ["departments"],
    enabled: canManage,
    queryFn: () => apiGet<{ departments: { id: string; name: string }[] }>("/api/v1/departments").then((r) => r.departments),
  });
  const positions = useQuery({
    queryKey: ["positions"],
    enabled: canManage,
    queryFn: () => apiGet<{ positions: { id: string; name: string; departmentId: string | null }[] }>("/api/v1/positions").then((r) => r.positions),
  });
  // 成员目录：部门侧栏（含子部门闭包）+ 搜索/状态/角色筛选，全部基于真实 /members + /departments
  const deptTree = (departmentOptions.data ?? []) as { id: string; name: string; parentId?: string | null }[];
  const childMap = new Map<string, string[]>();
  for (const d of deptTree) if (d.parentId) childMap.set(d.parentId, [...(childMap.get(d.parentId) ?? []), d.id]);
  const deptClosure = (id: string): string[] => {
    const out = [id];
    for (let i = 0; i < out.length; i++) for (const c of childMap.get(out[i]!) ?? []) out.push(c);
    return out;
  };
  const filteredRows = rows.filter((m) => {
    if (departmentFilter && !(m.departmentId && deptClosure(departmentFilter).includes(m.departmentId))) return false;
    if (statusFilter && m.status !== statusFilter) return false;
    if (roleFilter && !(m.roles ?? []).some((r) => r.key === roleFilter)) return false;
    const needle = memberQuery.trim().toLowerCase();
    if (needle && !`${m.name} ${m.username} ${m.email}`.toLowerCase().includes(needle)) return false;
    return true;
  });
  const allRoles = [...new Set(rows.flatMap((m) => (m.roles ?? []).map((r) => r.key)))].sort();
  const roleLabel = (key: string) => rows.flatMap((m) => m.roles ?? []).find((r) => r.key === key)?.name ?? key;
  const deptCount = (id: string) => rows.filter((m) => m.departmentId && deptClosure(id).includes(m.departmentId)).length;
  const maxLoad = Math.max(1, ...filteredRows.map((m) => m.load));
  const active = filteredRows.filter((m) => m.status === "ACTIVE").length;
  const totalLoad = filteredRows.reduce((n, m) => n + m.load, 0);

  return (
    <div className={`page members-page${memberTab === "directory" ? " data-page" : ""}`}>
      <PageHead title={t("nav.members")} actions={canCreate && memberTab === "directory" && <Button variant="primary" onClick={() => setCreateOpen(true)}><Icon name="plus" size={16} />{t("members.create")}</Button>} />
      <PageTabs id="members" label={t("nav.members")} value={memberTab} onChange={setMemberTab} tabs={[
        { value: "directory", label: t("memdir.tabDirectory") }, { value: "invites", label: t("memdir.tabInvites") },
        ...(canManage ? [{ value: "teams" as const, label: t("memdir.tabTeams") }] : []),
      ]} />
      <TabPanel tabsId="members" value="directory" activeValue={memberTab}>

      {q.isLoading && <StateBlock kind="loading" title={t("common.loading")} />}

      {!!rows.length && (
        <>
          <div className="metric-grid members-metric-grid">
            <MetricCard label={t("nav.members")} value={rows.length} tone="primary" />
            <MetricCard label={t("members.activeCount")} value={active} tone="success" />
            <MetricCard label={t("projects.metricItems")} value={totalLoad} />
          </div>

                <Panel className="members-directory data-fill" padding="none">
            <div className="members-directory-head">
              <strong style={{ fontSize: "var(--text-sm)" }}>{t("memdir.title")}<InfoTip text={t("memdir.sub")} /></strong>
            </div>
            <div className="members-directory-layout">
              <aside className="members-dept-side" aria-label={t("memdir.departments")}>
                <button type="button" className={`members-dept-item${departmentFilter === "" ? " is-active" : ""}`}
                  onClick={() => setDepartmentFilter("")}>
                  <span>{t("memdir.allMembers")}</span><span className="tag">{rows.length}</span>
                </button>
                {deptTree.map((d) => (
                  <button key={d.id} type="button" className={`members-dept-item${departmentFilter === d.id ? " is-active" : ""}`}
                    onClick={() => setDepartmentFilter(d.id)} style={{ paddingLeft: d.parentId ? 22 : 10 }}>
                    <span>{d.name}</span><span className="tag">{deptCount(d.id)}</span>
                  </button>
                ))}
              </aside>
              <div className="members-directory-main data-fill">
                <div className="toolbar" style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  <TextInput aria-label={t("memdir.search")} placeholder={t("memdir.search")} value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)} style={{ width: 220 }} />
                  <Select ariaLabel={t("memdir.status")} value={statusFilter} onChange={setStatusFilter} options={[
                    { value: "", label: t("memdir.allStatuses") },
                    { value: "ACTIVE", label: t("common.enabled") },
                    { value: "DISABLED", label: t("common.disabled") },
                  ]} />
                  <Select ariaLabel={t("memdir.role")} value={roleFilter} onChange={setRoleFilter} options={[
                    { value: "", label: t("memdir.allRoles") }, ...allRoles.map((k) => ({ value: k, label: roleLabel(k) })),
                  ]} />
                  <span className="muted" style={{ fontSize: "var(--text-xs)" }}>{filteredRows.length} / {rows.length}</span>
                </div>
                {filteredRows.length === 0 && <StateBlock kind="empty" title={t("memdir.empty")} />}
                {filteredRows.length > 0 && (
                  <TableScroll label={t("memdir.title")} resetKey={JSON.stringify([departmentFilter, statusFilter, roleFilter, memberQuery])}>
        <table className="data-table members-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th>{t("memdir.user")}</th>
                        <th>{t("memdir.department")}</th>
                        {/* 角色列加宽：多角色 chips（如「项目经理 · PROJECT」）在 fixed 表格布局下需要显式列宽 */}
                        <th>{t("memdir.role")}</th>
                        <th>{t("ms.loadTitle")}<InfoTip text={t("ms.loadHint")} label={t("ms.loadTitle")} /></th>
                        <th>{t("common.status")}</th>
                        {canManage && <th className="table-actions">{t("memdir.actions")}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((m) => (
                        <tr key={m.id} className="row-hover">
                          <td data-label={t("memdir.user")}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                              <span className="row-avatar" aria-hidden="true">{(m.name || m.username).slice(0, 1)}</span>
                              <span className="member-identity"><strong className="table-primary">{m.name}</strong><span className="table-secondary">{m.email}</span></span>
                            </span>
                          </td>
                          <td data-label={`${t("memdir.department")} / ${t("memdir.position")}`} className="muted">
                            <span style={{ display: "block" }}>{m.departmentName ?? "—"}</span>
                            {m.positionName && <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>{m.positionName}</span>}
                          </td>
                          <td data-label={t("memdir.role")} style={{ minWidth: 172 }}>
                            {/* flex-wrap + 列 min-width：多角色 chips 换行、长 chip 省略，不再溢出压到状态列（走查 P3-5） */}
                            {(m.roles ?? []).length === 0 ? <span className="muted">—</span> : (
                              <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {(m.roles ?? []).map((r) => (
                                  <span key={`${r.key}-${r.scopeType}`} className="tag"
                                    style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {r.name}<span className="muted"> · {["ORG", "PROJECT", "DEPARTMENT", "TEAM", "SELF"].includes(r.scopeType) ? t(`member.scope.${r.scopeType}`) : r.scopeType}</span>
                                  </span>
                                ))}
                              </span>
                            )}
                          </td>
                          <td data-label={t("ms.loadTitle")} title={t("ms.loadHint")}>
                            <span className="members-load-inline">
                              <span className="members-load-track"><span style={{ width: `${Math.round((m.load / maxLoad) * 100)}%` }} /></span>
                              <b>{m.load}</b>
                            </span>
                          </td>
                          <td data-label={t("common.status")}><span className={`status-pill${m.status === "ACTIVE" ? " dot-green" : " dot-red"}`}>{m.status === "ACTIVE" ? t("common.enabled") : t("common.disabled")}</span></td>
                          {canManage && (
                            <td className="table-actions" data-label={t("memdir.actions")}>
                              <span className="table-actions-group">
                                <Button size="sm" onClick={() => setOrgTarget({ id: m.id, name: m.name, departmentId: m.departmentId ?? "", positionId: m.positionId ?? "" })}>{t("org.assign")}</Button>
                                <Button size="sm" onClick={() => setPermTarget({ id: m.id, name: m.name })}>{t("ms.permissions")}</Button>
                              </span>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
        </TableScroll>
                )}
              </div>
            </div>
          </Panel>

        </>
      )}

      {q.isError && <StateBlock kind="error" title={t("common.loadFailedShort")} action={() => void q.refetch()} actionLabel={t("common.reload")} />}
      {q.isSuccess && rows.length === 0 && <StateBlock kind="empty" title={t("members.empty")}
        action={canCreate ? () => setCreateOpen(true) : undefined} actionLabel={canCreate ? t("members.create") : undefined} />}
      </TabPanel>
      <TabPanel tabsId="members" value="invites" activeValue={memberTab}><InvitePanel /></TabPanel>
      {canManage && <TabPanel tabsId="members" value="teams" activeValue={memberTab}><TeamPanel /></TabPanel>}


      <MemberPermissionsDrawer member={permTarget} onClose={() => setPermTarget(null)} />
      {canCreate && <CreateMemberDrawer open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => {
        setCreateOpen(false); setMemberTab("directory"); setMemberQuery(""); setDepartmentFilter(""); setStatusFilter(""); setRoleFilter("");
      }} />}

      {orgDraft.guard}
      <Drawer open={!!orgTarget} onClose={closeOrg} title={`${t("org.assign")} · ${orgTarget?.name ?? ""}`}>
        {orgError && <p className="field-error" role="alert">{orgError}</p>}
        {(departments.isError || positions.isError) && <StateBlock kind="error" title={t("common.loadFailedShort")} action={() => { void departments.refetch(); void positions.refetch(); }} actionLabel={t("common.reload")} />}
        {orgTarget && (
          <div style={{ display: "grid", gap: 10 }}>
            <Select label={t("org.department")} ariaLabel={t("org.department")} value={orgTarget.departmentId} searchable disabled={orgBusy || departments.isLoading || departments.isError}
              onChange={(v) => setOrgTarget({ ...orgTarget, departmentId: v, positionId: "" })}
              options={[{ value: "", label: t("org.noDepartment") }, ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))]} />
            <Select label={t("org.position")} ariaLabel={t("org.position")} value={orgTarget.positionId} searchable disabled={orgBusy || positions.isLoading || positions.isError}
              onChange={(v) => setOrgTarget({ ...orgTarget, positionId: v })}
              options={[{ value: "", label: t("org.noPosition") }, ...(positions.data ?? []).filter((p) => !orgTarget.departmentId || !p.departmentId || p.departmentId === orgTarget.departmentId).map((p) => ({ value: p.id, label: p.name }))]} />
            <Button variant="primary" loading={orgBusy} disabled={orgBusy || departments.isLoading || positions.isLoading || departments.isError || positions.isError} onClick={() => {
              if (orgBusy) return;
              setOrgBusy(true); setOrgError(null);
              void apiPatch(`/api/v1/members/${orgTarget.id}/organization`, {
                departmentId: orgTarget.departmentId || null, positionId: orgTarget.positionId || null,
              }).then(async () => {
                await qc.invalidateQueries({ queryKey: ["members"] });
                setOrgTarget(null);
              }).catch((e) => { setOrgError(e instanceof ApiError ? e.message : t("org.saveFailed")); }).finally(() => setOrgBusy(false));
            }}>{t("common.save")}</Button>
          </div>
        )}
      </Drawer>
    </div>
  );
}
