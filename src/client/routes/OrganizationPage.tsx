import { PageTabs, TabPanel } from "../components/ui/PageTabs.tsx";
import { TableScroll } from "../components/ui/TableScroll.tsx";
/**
 * 组织架构管理（Round 66 · 对标 YouQu 部门/职位 P1）
 *
 * 左：部门树（真实 memberCount，直属）；右：职位列表（可挂部门）。
 * 删除 = 归档（可恢复）；成员归属在成员页单独编辑。全部操作走真实接口。
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { t, useLocale } from "../i18n/index.ts";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "../lib/api.ts";
import { useActor } from "../lib/actor.ts";
import { PageHead } from "../components/Page.tsx";
import { Button } from "../components/ui/Button.tsx";
import { ConfirmButton } from "../components/ui/ConfirmButton.tsx";
import { Panel } from "../components/ui/Panel.tsx";
import { Drawer } from "../components/ui/Drawer.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { TextArea } from "../components/ui/TextArea.tsx";
import { Select } from "../components/Select.tsx";
import { StateBlock } from "../components/ui/StateBlock.tsx";
import { OrganizationChart } from "../components/OrganizationChart.tsx";
import { TreeLayout } from "../components/layout/TreeLayout.tsx";
import { Tree, type TreeNode } from "../components/ui/Tree.tsx";
import { useSettingsDraft } from "../components/settings/SettingsDraft.tsx";

interface DeptRow { id: string; name: string; parentId: string | null; memberCount: number; sortOrder: number }
interface PositionRow { id: string; name: string; code: string | null; departmentId: string | null; departmentName: string | null; description: string | null; memberCount: number }

export function OrganizationPage() {
  useLocale();
  const qc = useQueryClient();
  const actor = useActor();
  const canManage = actor.permissions.includes("member:manage") && actor.dataScopes.some((s) => s.scopeType === "ORG");
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => apiGet<{ departments: DeptRow[] }>("/api/v1/departments").then((r) => r.departments) });
  const positions = useQuery({ queryKey: ["positions"], queryFn: () => apiGet<{ positions: PositionRow[] }>("/api/v1/positions").then((r) => r.positions) });
  const [draft, setDraft] = useState<{ mode: "create" | "edit"; id?: string; name: string; parentId: string } | null>(null);
  const [posDraft, setPosDraft] = useState<{ mode: "create" | "edit"; id?: string; name: string; code: string; departmentId: string; description: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"tree" | "chart">("tree");
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(() => new Set());
  const [detailTab, setDetailTab] = useState<"members" | "positions">("members");
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateKind, setTemplateKind] = useState<"COMPANY" | "OPC">("COMPANY");
  const deptGuard = useSettingsDraft(!!draft, draft, busy);
  const positionGuard = useSettingsDraft(!!posDraft, posDraft, busy);
  interface OrgMemberRow { id: string; name: string; username: string; departmentId: string | null; departmentName: string | null; positionId: string | null; positionName: string | null }
  const members = useQuery({
    queryKey: ["members", "org-chart"],
    enabled: canManage,
    queryFn: () => apiGet<{ members: OrgMemberRow[] }>("/api/v1/members").then((r) => r.members),
  });

  const deptTreeNodes = useMemo<TreeNode[]>(() => {
    const rows = departments.data ?? [];
    const byParent = new Map<string, DeptRow[]>();
    for (const d of rows) {
      const k = d.parentId ?? "";
      byParent.set(k, [...(byParent.get(k) ?? []), d]);
    }
    const build = (parent: string): TreeNode[] => (byParent.get(parent) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((d) => ({ id: d.id, label: d.name, extra: d.memberCount, children: build(d.id) }));
    return [{ id: "__all__", label: t("org.allDepartments"), extra: rows.reduce((n, d) => n + d.memberCount, 0) }, ...build("")];
  }, [departments.data, t]);
  const selectedDept = (departments.data ?? []).find((d) => d.id === selectedDeptId) ?? null;
  const visibleMembers = (members.data ?? []).filter((m) => !selectedDeptId || m.departmentId === selectedDeptId);
  const visiblePositions = (positions.data ?? []).filter((p) => !selectedDeptId || p.departmentId === selectedDeptId);
  const deptOptions = [{ value: "", label: t("org.noDepartment") }, ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))];

  const refresh = () => { void qc.invalidateQueries({ queryKey: ["departments"] }); void qc.invalidateQueries({ queryKey: ["positions"] }); };
  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setError(null); setBusy(true);
    try { await fn(); refresh(); } catch (e) { setError(e instanceof ApiError ? e.message : t("org.saveFailed")); }
    finally { setBusy(false); }
  };
  const saveDept = () => {
    if (!draft?.name.trim()) return;
    void run(async () => {
      if (draft.mode === "create") await apiPost("/api/v1/departments", { name: draft.name.trim(), parentId: draft.parentId || null });
      else await apiPatch(`/api/v1/departments/${draft.id}`, { name: draft.name.trim(), parentId: draft.parentId || null });
      setDraft(null);
    });
  };
  const savePos = () => {
    if (!posDraft?.name.trim()) return;
    void run(async () => {
      const body = { name: posDraft.name.trim(), code: posDraft.code.trim() || null, departmentId: posDraft.departmentId || null, description: posDraft.description.trim() || null };
      if (posDraft.mode === "create") await apiPost("/api/v1/positions", body);
      else await apiPatch(`/api/v1/positions/${posDraft.id}`, body);
      setPosDraft(null);
    });
  };
  const archiveDept = (id: string) => void run(async () => { await apiDelete(`/api/v1/departments/${id}`); });
  const applyTemplate = async () => {
    if (busy) return;
    setError(null); setBusy(true);
    try {
      await apiPost("/api/v1/organization/template", { kind: templateKind });
      const next = await apiGet<{ departments: DeptRow[] }>("/api/v1/departments");
      // 模板最容易“看起来没数据”的原因：新部门挂在已有父部门下面，而树默认收起。
      // 应用后自动展开全部节点，并切到职位表，让新增结果立刻可见。
      setExpandedDepts(new Set((next.departments ?? []).map((d) => d.id)));
      setSelectedDeptId(null);
      setDetailTab("positions");
      setTemplateOpen(false);
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("org.saveFailed"));
    } finally { setBusy(false); }
  };
  const archivePos = (id: string) => void run(async () => { await apiDelete(`/api/v1/positions/${id}`); });

  if (canManage && (departments.isLoading || positions.isLoading || members.isLoading)) return <div className="page"><PageHead title={t("org.title")} /><StateBlock kind="loading" title={t("common.loading")} /></div>;
  if (canManage && ((departments.isError && !departments.data) || (positions.isError && !positions.data) || (members.isError && !members.data))) return <div className="page"><PageHead title={t("org.title")} /><StateBlock kind="error" title={t("common.loadFailedShort")} action={() => { void departments.refetch(); void positions.refetch(); void members.refetch(); }} actionLabel={t("common.reload")} /></div>;

  return (
    <div className={`page organization-page${canManage && view === "tree" ? " data-page" : ""}`}>
      <PageHead title={t("org.title")}
        actions={canManage ? (
          <>
            <div className="page-view-switcher ui-segmented" role="group" aria-label={t("org.viewSwitch")}>
              <button type="button" className="ui-segmented-item" aria-pressed={view === "tree"} onClick={() => setView("tree")}>{t("org.treeView")}</button>
              <button type="button" className="ui-segmented-item" aria-pressed={view === "chart"} onClick={() => setView("chart")}>{t("org.chartView")}</button>
            </div>
            <Button size="sm" onClick={() => setTemplateOpen(true)}>{t("org.template")}</Button>
            <Button variant="primary" onClick={() => setDraft({ mode: "create", name: "", parentId: "" })}>{t("org.addDepartment")}</Button>
          </>
        ) : undefined} />
      {!canManage && <StateBlock kind="restricted" title={t("org.restricted")} description={t("org.restrictedHint")} />}
      {canManage && (
        <>
          {error && !draft && !posDraft && !templateOpen && <p className="field-error" role="alert">{error}</p>}
          {deptGuard.guard}{positionGuard.guard}
          {view === "chart" ? (
            <OrganizationChart
              departments={(departments.data ?? []).map((d) => ({ id: d.id, name: d.name, parentId: d.parentId, sortOrder: d.sortOrder, memberCount: d.memberCount }))}
              members={members.data ?? []}
            />
          ) : (
            <TreeLayout treeWidth={280} treeLabel={t("org.departments")}
              tree={<Tree nodes={deptTreeNodes} ariaLabel={t("org.departments")}
                emptyText={t("org.noDepartments")} selectedId={selectedDeptId ?? "__all__"}
                expandedIds={expandedDepts}
                onSelect={(id) => { setSelectedDeptId(id === "__all__" ? null : id); setDetailTab("members"); }}
                onToggle={(id) => setExpandedDepts((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; })} />}>
              <Panel className="data-fill">
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <strong style={{ fontSize: "var(--text-base)" }}>{selectedDept?.name ?? t("org.allDepartments")}</strong>
                    <p className="muted" style={{ margin: "4px 0 0", fontSize: "var(--text-xs)" }}>
                      {selectedDept ? t("org.selectedDeptHint", { n: String(selectedDept.memberCount) }) : t("org.allDeptHint")}
                    </p>
                  </div>
                  <span style={{ flex: 1 }} />
                  {selectedDept && <>
                    <Button size="sm" onClick={() => setDraft({ mode: "create", name: "", parentId: selectedDept.id })}>{t("org.addChild")}</Button>
                    <Button size="sm" onClick={() => setDraft({ mode: "edit", id: selectedDept.id, name: selectedDept.name, parentId: selectedDept.parentId ?? "" })}>{t("common.edit")}</Button>
                    <ConfirmButton size="sm" confirmText={t("common.confirmArchive")} onConfirm={() => archiveDept(selectedDept.id)}>{t("common.archive")}</ConfirmButton>
                  </>}
                </div>
                <div className="org-detail-toolbar">
                  <PageTabs id="organization" label={t("org.title")} value={detailTab} onChange={setDetailTab} tabs={[
                    { value: "members", label: `${t("org.members")} ${visibleMembers.length}` },
                    { value: "positions", label: `${t("org.positions")} ${visiblePositions.length}` },
                  ]} />
                  {detailTab === "positions" && <Button size="sm" onClick={() => setPosDraft({ mode: "create", name: "", code: "", departmentId: selectedDeptId ?? "", description: "" })}>{t("org.addPosition")}</Button>}
                </div>
                <TabPanel tabsId="organization" value="members" activeValue={detailTab} className="data-fill">
                <TableScroll label={t("org.members")} resetKey={JSON.stringify([selectedDeptId, detailTab])}>
                  <table className="data-table org-data-table org-members-table">
                    <thead><tr><th>{t("org.member")}</th><th>{t("org.username")}</th><th>{t("org.department")}</th><th>{t("org.position")}</th></tr></thead>
                    <tbody>
                      {visibleMembers.map((m) => (
                        <tr key={m.id}>
                          <td data-label={t("org.member")}><div className="row-title"><span className="row-avatar">{(m.name || m.username).slice(0,1)}</span><span className="row-name">{m.name}</span></div></td>
                          <td data-label={t("org.username")} className="muted">@{m.username}</td>
                          <td data-label={t("org.department")}>{m.departmentName ?? "—"}</td>
                          <td data-label={t("org.position")}>{m.positionName ?? "—"}</td>
                        </tr>
                      ))}
                      {visibleMembers.length === 0 && <tr><td colSpan={4} className="muted" style={{ padding: 24, textAlign: "center" }}>{t("org.noMembersInDept")}</td></tr>}
                    </tbody>
                  </table>
                </TableScroll>
                </TabPanel>
                <TabPanel tabsId="organization" value="positions" activeValue={detailTab} className="data-fill">
                <TableScroll label={t("org.positions")} resetKey={JSON.stringify([selectedDeptId, detailTab])}>
                  <table className="data-table org-data-table org-positions-table">
                    <thead><tr><th>{t("org.name")}</th><th>{t("org.code")}</th><th>{t("org.department")}</th><th className="table-number">{t("org.memberCount")}</th><th className="table-actions">{t("common.actions")}</th></tr></thead>
                    <tbody>
                      {visiblePositions.map((p) => (
                        <tr key={p.id}><td className="table-primary" data-label={t("org.name")}>{p.name}</td><td data-label={t("org.code")} className="mono">{p.code ?? "—"}</td><td data-label={t("org.department")}>{p.departmentName ?? "—"}</td><td className="table-number" data-label={t("org.memberCount")}>{p.memberCount}</td><td style={{ textAlign: "right" }}>
                          <Button size="sm" variant="ghost" onClick={() => setPosDraft({ mode: "edit", id: p.id, name: p.name, code: p.code ?? "", departmentId: p.departmentId ?? "", description: p.description ?? "" })}>{t("common.edit")}</Button>
                          <ConfirmButton size="sm" confirmText={t("common.confirmArchive")} onConfirm={() => archivePos(p.id)}>{t("common.archive")}</ConfirmButton>
                        </td></tr>
                      ))}
                      {visiblePositions.length === 0 && <tr><td colSpan={5} className="muted" style={{ padding: 24, textAlign: "center" }}>{t("org.noPositionsInDept")}</td></tr>}
                    </tbody>
                  </table>
                </TableScroll>
                </TabPanel>
              </Panel>
            </TreeLayout>
          )}
          <Drawer open={templateOpen} onClose={() => !busy && setTemplateOpen(false)} title={t("org.template")}>
            {error && <p className="field-error" role="alert">{error}</p>}
            <div style={{ display: "grid", gap: 10 }}>
              <p className="muted" style={{ margin: 0, fontSize: "var(--text-xs)", lineHeight: 1.6 }}>{t("org.templateHint")}</p>
              <div className="setup-db-choice" role="radiogroup" aria-label={t("org.template")}>
                <button type="button" role="radio" aria-checked={templateKind === "COMPANY"}
                  className={`setup-db-choice-card${templateKind === "COMPANY" ? " is-active" : ""}`}
                  onClick={() => setTemplateKind("COMPANY")}>
                  <span className="setup-db-choice-radio" aria-hidden="true">{templateKind === "COMPANY" ? "●" : "○"}</span>
                  <span><strong>{t("org.templateCompany")}</strong><small>{t("org.templateCompanyHint")}</small></span>
                </button>
                <button type="button" role="radio" aria-checked={templateKind === "OPC"}
                  className={`setup-db-choice-card${templateKind === "OPC" ? " is-active" : ""}`}
                  onClick={() => setTemplateKind("OPC")}>
                  <span className="setup-db-choice-radio" aria-hidden="true">{templateKind === "OPC" ? "●" : "○"}</span>
                  <span><strong>{t("org.templateOpc")}</strong><small>{t("org.templateOpcHint")}</small></span>
                </button>
              </div>
              <div className="drawer-actions">
                <Button variant="ghost" disabled={busy} onClick={() => setTemplateOpen(false)}>{t("common.cancel")}</Button>
                <Button variant="primary" loading={busy} disabled={busy} onClick={applyTemplate}>{t("org.templateApply")}</Button>
              </div>
            </div>
          </Drawer>

          <Drawer open={!!draft} onClose={() => void deptGuard.leave(() => { setDraft(null); setError(null); })} title={draft?.mode === "create" ? t("org.addDepartment") : t("org.editDepartment")}>
            {error && <p className="field-error" role="alert">{error}</p>}
            {draft && (
              <div style={{ display: "grid", gap: 10 }}>
                <TextInput label={t("org.name")} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                <Select label={t("org.parent")} ariaLabel={t("org.parent")} value={draft.parentId} onChange={(v) => setDraft({ ...draft, parentId: v })} searchable
                  options={deptOptions.filter((o) => o.value !== draft.id)} />
                <Button variant="primary" loading={busy} disabled={busy || !draft.name.trim()} onClick={saveDept}>{t("common.save")}</Button>
              </div>
            )}
          </Drawer>

          <Drawer open={!!posDraft} onClose={() => void positionGuard.leave(() => { setPosDraft(null); setError(null); })} title={posDraft?.mode === "create" ? t("org.addPosition") : t("org.editPosition")}>
            {error && <p className="field-error" role="alert">{error}</p>}
            {posDraft && (
              <div style={{ display: "grid", gap: 10 }}>
                <TextInput label={t("org.name")} value={posDraft.name} onChange={(e) => setPosDraft({ ...posDraft, name: e.target.value })} />
                <TextInput label={t("org.code")} value={posDraft.code} onChange={(e) => setPosDraft({ ...posDraft, code: e.target.value })} hint={t("org.codeHint")} />
                <Select label={t("org.department")} ariaLabel={t("org.department")} value={posDraft.departmentId} onChange={(v) => setPosDraft({ ...posDraft, departmentId: v })} searchable options={deptOptions} />
                <TextArea label={t("org.description")} rows={2} value={posDraft.description} onChange={(e) => setPosDraft({ ...posDraft, description: e.target.value })} />
                <Button variant="primary" loading={busy} disabled={busy || !posDraft.name.trim()} onClick={savePos}>{t("common.save")}</Button>
              </div>
            )}
          </Drawer>
        </>
      )}
    </div>
  );
}
