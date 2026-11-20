/**
 * 团队面板（Round 25 长任务第 44 项）
 *
 * 后端 team 表从第一期就有，但**没有任何界面**：团队是 A2 数据范围（TEAM）的承载，
 * 管理员此前只能直接改库。本面板提供树形浏览 + 建/改名/移动/删除 + 成员展开。
 * 写操作仅 member:manage 可见；成员来源 = scope_type='TEAM' 的角色指派（含子团队展开）。
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "../lib/api.ts";
import { toast } from "./ui/Toast.tsx";
import { t } from "../i18n/index.ts";
import { useCan } from "../lib/actor.ts";
import { Button } from "./ui/Button.tsx";
import { Modal } from "./ui/Modal.tsx";
import { confirmDialog } from "./Dialog.tsx";
import { Drawer } from "./ui/Drawer.tsx";
import { Select } from "./Select.tsx";
import { TextInput } from "./ui/TextInput.tsx";
import { Panel } from "./ui/Panel.tsx";
import { StateBlock } from "./ui/StateBlock.tsx";
import { useSettingsDraft } from "./settings/SettingsDraft.tsx";

export interface TeamNode {
  id: string; name: string; parentId: string | null; sortOrder: number;
  memberCount: number; children: TeamNode[];
}
interface TeamMember { id: string; name: string; username: string; roles: string[] }

function flatten(nodes: TeamNode[], depth = 0): { id: string; label: string }[] {
  return nodes.flatMap((n) => [{ id: n.id, label: `${"　".repeat(depth)}${n.name}` }, ...flatten(n.children, depth + 1)]);
}

export function TeamPanel() {
  const canManage = useCan("member:manage");
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["teams"],
    queryFn: () => apiGet<{ teams: TeamNode[] }>("/api/v1/teams").then((r) => r.teams),
    retry: false,
  });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TeamNode | null>(null);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [membersOf, setMembersOf] = useState<TeamNode | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const members = useQuery({
    queryKey: ["team-members", membersOf?.id],
    enabled: !!membersOf,
    retry: false,
    queryFn: () => apiGet<{ teamIds: string[]; members: TeamMember[] }>(`/api/v1/teams/${membersOf!.id}/members`),
  });

  const parentOptions = useMemo(() => {
    const all = flatten(list.data ?? []).filter((x) => x.id !== editing?.id)
      .map((x) => ({ value: x.id, label: x.label }));
    return [{ value: "", label: t("team.root") }, ...all];
  }, [list.data, editing]);

  const reset = () => { setFormOpen(false); setEditing(null); setName(""); setParentId(""); setFormError(null); };
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t("team.failed"));
  const done = async (msg: string) => {
    toast.success(msg); reset();
    await qc.invalidateQueries({ queryKey: ["teams"] });
  };
  const save = useMutation({
    mutationFn: () => editing
      ? apiPatch(`/api/v1/teams/${editing.id}`, { name: name.trim(), parentId: parentId || null })
      : apiPost("/api/v1/teams", { name: name.trim(), parentId: parentId || null }),
    onSuccess: () => void done(t("team.saved")),
    onError: (e) => setFormError(e instanceof ApiError ? e.message : t("team.failed")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/teams/${id}`),
    onSuccess: () => { void done(t("team.deleted")); },
    onError: (e) => { fail(e); },
  });

  const startCreate = (parent?: TeamNode) => {
    setFormError(null);
    setEditing(null); setName(""); setParentId(parent?.id ?? ""); setFormOpen(true);
  };
  const startEdit = (node: TeamNode) => {
    setFormError(null);
    setEditing(node); setName(node.name); setParentId(node.parentId ?? ""); setFormOpen(true);
  };

  const draft = useSettingsDraft(formOpen, { name, parentId }, save.isPending);
  const requestClose = () => void draft.leave(reset);

  // ⚠️ 结构：**行与子列表是兄弟**（不是把子列表塞进行里）——否则父行会包含所有后代文本/按钮，
  //    自动化选择器与读屏都会把"点的到底是哪一行"搞混（浏览器验收实际踩到 strict violation）。
  const renderNodes = (nodes: TeamNode[]): React.ReactNode => nodes.map((n) => (
    <li key={n.id} className="team-node">
      <div className="team-row" data-team-name={n.name}>
        <span className="team-name">{n.name}</span>
        <span className="muted" style={{ fontSize: "var(--text-xs)" }}>{t("team.memberCount", { n: String(n.memberCount) })}</span>
        <Button size="sm" variant="ghost" onClick={() => setMembersOf(n)}>{t("team.viewMembers")}</Button>
        {canManage && (
          <>
            <Button size="sm" variant="ghost" onClick={() => startCreate(n)}>{t("team.addChild")}</Button>
            <Button size="sm" variant="ghost" onClick={() => startEdit(n)}>{t("team.edit")}</Button>
            <Button size="sm" variant="danger" disabled={remove.isPending} onClick={async () => { if (await confirmDialog(`${t("common.confirmDelete")} ${n.name}`, { danger: true })) remove.mutate(n.id); }}>{t("team.delete")}</Button>
          </>
        )}
      </div>
      {n.children.length > 0 && <ul className="team-children">{renderNodes(n.children)}</ul>}
    </li>
  ));

  return (
    <div style={{ marginTop: 16 }}>
      <Panel>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <strong style={{ fontSize: "var(--text-sm)" }}>{t("team.title")}</strong>
          <span className="muted" style={{ fontSize: "var(--text-xs)" }}>{t("team.sub")}</span>
          <span style={{ flex: 1 }} />
          {canManage && <Button size="sm" onClick={() => startCreate()}>{t("team.new")}</Button>}
        </div>
        {list.isLoading && <StateBlock kind="loading" title={t("common.loading")} />}
        {list.isError && <StateBlock kind="error" title={t("team.failed")} action={() => void list.refetch()} actionLabel={t("common.reload")} />}
        {list.data && list.data.length === 0 && <p className="muted" style={{ fontSize: "var(--text-sm)" }}>{t("team.empty")}</p>}
        {!!list.data?.length && <ul className="team-tree">{renderNodes(list.data)}</ul>}
      </Panel>

      {draft.guard}
      <Modal open={formOpen} title={editing ? t("team.edit") : t("team.new")} onClose={requestClose} width="sm" footer={<>
          <Button variant="ghost" onClick={requestClose} disabled={save.isPending}>{t("common.cancel")}</Button>
          <Button variant="primary" loading={save.isPending} disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>{t("common.save")}</Button>
        </>}>
        {formError && <p className="field-error" role="alert">{formError}</p>}
        <fieldset disabled={save.isPending} className="settings-form-fields">
        <TextInput label={t("team.name")} aria-label={t("team.name")} value={name} onChange={(e) => setName(e.target.value)} />
        <div style={{ marginTop: 12 }}>
          <Select label={t("team.parent")} ariaLabel={t("team.parent")} value={parentId} onChange={setParentId} options={parentOptions} searchable />
        </div>
        </fieldset>
      </Modal>

      <Drawer open={!!membersOf} title={membersOf ? `${membersOf.name} · ${t("team.viewMembers")}` : ""} onClose={() => setMembersOf(null)} width="sm">
        {members.isLoading && <p className="muted">{t("common.loading")}</p>}
        {members.isError && <StateBlock kind="error" title={t("team.failed")} action={() => void members.refetch()} actionLabel={t("common.reload")} />}
        {members.data && members.data.members.length === 0 && <p className="muted">{t("team.noMembers")}</p>}
        {!!members.data?.members.length && (
          <ul className="team-members">
            {members.data.members.map((m) => (
              <li key={m.id}>
                <span className="row-avatar" aria-hidden="true">{m.name.slice(0, 1)}</span>
                <span>{m.name}</span>
                <span className="muted mono" style={{ fontSize: "var(--text-xs)" }}>{m.username}</span>
                <span className="muted" style={{ fontSize: "var(--text-xs)", marginLeft: "auto" }}>{m.roles.join(", ")}</span>
              </li>
            ))}
          </ul>
        )}
      </Drawer>
    </div>
  );
}
