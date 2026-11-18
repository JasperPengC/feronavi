/** 项目设置：编辑名称/描述/负责人（项目 key 创建后不可改，由服务端 strict schema 拒绝）。 */
import { queryKeys } from "../../lib/query-keys.ts";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, ApiError } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { Drawer } from "../ui/Drawer.tsx";
import { Button } from "../ui/Button.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { TextArea } from "../ui/TextArea.tsx";
import { Select } from "../Select.tsx";
import { StateBlock } from "../ui/StateBlock.tsx";
import { useSettingsDraft } from "../settings/SettingsDraft.tsx";

interface Member { id: string; name: string; username: string }

export function ProjectSettingsDrawer({
  open, project, onClose, onSaved,
}: {
  open: boolean;
  project: { id: string; name: string; description: string | null; lead: { id: string; name: string } | null; status: { key: string; name: string } | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [leadId, setLeadId] = useState(project.lead?.id ?? "");
  const [statusKey, setStatusKey] = useState(project.status?.key ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    draft.markSaved({ name: project.name, description: project.description ?? "", leadId: project.lead?.id ?? "", statusKey: project.status?.key ?? "" });
    setName(project.name); setDescription(project.description ?? ""); setLeadId(project.lead?.id ?? ""); setStatusKey(project.status?.key ?? ""); setError(null);
  // 同一打开会话内，后台刷新不得覆盖未保存输入。
  }, [open, project.id]);

  const statuses = useQuery({
    queryKey: ["project-statuses"],
    enabled: open,
    retry: false,
    queryFn: () => apiGet<{ key: string; name: string; category: string }[]>("/api/v1/project-statuses"),
  });
  const members = useQuery({
    queryKey: ["project-members", project.id],
    enabled: open,
    retry: false,
    queryFn: () => apiGet<{ members: Member[] }>(`/api/v1/projects/${project.id}/members`).then((r) => r.members ?? []),
  });
  const save = useMutation({
    mutationFn: async () => {
      await apiPatch(`/api/v1/projects/${project.id}`, {
        name: name.trim(), description: description.trim() || null, leadMemberId: leadId || null,
      });
      if (statusKey && statusKey !== project.status?.key) {
        const { apiPost } = await import("../../lib/api.ts");
        await apiPost(`/api/v1/projects/${project.id}/status`, { statusKey });
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.projectOverview(project.id) });
      await qc.invalidateQueries({ queryKey: queryKeys.projects() });
      onSaved(); onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("po.saveFailed")),
  });

  const draft = useSettingsDraft(open, { name, description, leadId, statusKey }, save.isPending);
  const requestClose = () => void draft.leave(onClose);

  return (
    <Drawer open={open} title={t("po.settings")} onClose={requestClose} width="sm">
      {draft.guard}
      {(members.isError || statuses.isError) && <StateBlock kind="error" title={t("common.loadFailedShort")} action={() => { void members.refetch(); void statuses.refetch(); }} actionLabel={t("common.reload")} />}
      <fieldset disabled={save.isPending} className="settings-form-fields">
      <div style={{ display: "grid", gap: 12 }}>
        <TextInput label={t("common.name")} required value={name} onChange={(e) => setName(e.target.value)} />
        <TextInput label={t("po.key")} value={project.id.slice(0, 8)} disabled hint={t("po.keyImmutable")} />
        <TextArea label={t("common.description")} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        <Select label={t("po.status")} value={statusKey} ariaLabel={t("po.status")}
          onChange={setStatusKey}
          options={[{ value: "", label: t("wie.none") }, ...(statuses.data ?? []).map((s) => ({ value: s.key, label: s.name }))]} />
        <Select label={t("po.lead")} value={leadId} ariaLabel={t("po.lead")} searchable
          onChange={setLeadId}
          options={[{ value: "", label: t("wie.unassigned") }, ...(members.data ?? []).map((m) => ({ value: m.id, label: `${m.name} @${m.username}` }))]} />
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="drawer-actions">
          <Button variant="ghost" onClick={requestClose} disabled={save.isPending}>{t("common.cancel")}</Button>
          <Button variant="primary" loading={save.isPending} disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>{t("common.save")}</Button>
        </div>
      </div>
      </fieldset>
    </Drawer>
  );
}
