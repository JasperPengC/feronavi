/**
 * 成员邀请（Round 25 长任务第 49 项）
 *
 * 总纲 5.11：管理员邀请制，邀请链接 **7 天、单次使用**；明文 token 只在创建响应出现一次
 * （界面明确提示"复制后妥善保存"，台账只展示状态不展示 token）。
 */
import { queryKeys } from "../lib/query-keys.ts";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, ApiError } from "../lib/api.ts";
import { t } from "../i18n/index.ts";
import { useCan } from "../lib/actor.ts";
import { Button } from "./ui/Button.tsx";
import { confirmDialog } from "./Dialog.tsx";
import { Drawer } from "./ui/Drawer.tsx";
import { TextInput } from "./ui/TextInput.tsx";
import { Select } from "./Select.tsx";
import { Panel } from "./ui/Panel.tsx";
import { StateBlock } from "./ui/StateBlock.tsx";
import { useSettingsDraft } from "./settings/SettingsDraft.tsx";

interface InviteRow { id: string; email: string; status: "PENDING" | "USED" | "EXPIRED"; expiresAt: string; usedAt: string | null }

export function InvitePanel() {
  const canInvite = useCan("member:invite");
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["invites"],
    queryFn: () => apiGet<{ invites: InviteRow[] }>("/api/v1/invites").then((r) => r.invites),
    enabled: canInvite,
    retry: false,
  });
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [projectId, setProjectId] = useState("");
  const [roleId, setRoleId] = useState("");
  const canRole = useCan("role:manage");
  const projects = useQuery({
    queryKey: queryKeys.projects("invite-options"),
    queryFn: () => apiGet<{ items: { id: string; name: string; key: string }[] }>("/api/v1/projects").then((r) => r.items),
    enabled: canInvite, retry: false,
  });
  const roles = useQuery({
    queryKey: ["roles", "invite-options"],
    queryFn: () => apiGet<{ roles: { id: string; name: string; key: string }[] }>("/api/v1/roles").then((r) => r.roles),
    enabled: canInvite && canRole, retry: false,
  });
  const [created, setCreated] = useState<{ id: string; inviteUrl: string; expiresAt: string; emailQueued?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useMutation({
    mutationFn: () => apiPost<{ id: string; inviteUrl: string; expiresAt: string; emailQueued: boolean }>("/api/v1/invites", {
      email: email.trim(),
      ...(projectId ? { projectId, projectRoleIds: roleId ? [roleId] : [] } : {}),
    }),
    onSuccess: async (r) => {
      setCreated(r); setError(null); setCopied(false);
      await qc.invalidateQueries({ queryKey: ["invites"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("invite.failed")),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/invites/${id}`),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["invites"] }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("invite.failed")),
  });
  const close = () => { setOpen(false); setEmail(""); setProjectId(""); setRoleId(""); setCreated(null); setError(null); setCopied(false); };
  const draft = useSettingsDraft(open && !created, { email, projectId, roleId }, create.isPending);
  const requestClose = () => void draft.leave(close);
  if (!canInvite) return null;
  const link = created ? `${window.location.origin}${created.inviteUrl}` : "";
  return (
    <div style={{ marginTop: 16 }}>
      <Panel>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <strong style={{ fontSize: "var(--text-sm)" }}>{t("invite.title")}</strong>
          <span className="muted" style={{ fontSize: "var(--text-xs)" }}>{t("invite.sub")}</span>
          <span style={{ flex: 1 }} />
          <Button size="sm" onClick={() => setOpen(true)}>{t("invite.new")}</Button>
        </div>
        {!!list.data?.length && (
          <ul className="invite-list">
            {list.data.map((i) => (
              <li key={i.id}>
                <span>{i.email}</span>
                <span className={`tag ${i.status === "PENDING" ? "tag-success" : i.status === "EXPIRED" ? "tag-warning" : ""}`}>
                  {t(`invite.status.${i.status}`)}
                </span>
                <span className="muted" style={{ fontSize: "var(--text-xs)" }}>{new Date(i.expiresAt).toLocaleString()}</span>
                {i.status === "PENDING" && (
                  <Button size="sm" variant="ghost" disabled={revoke.isPending} onClick={async () => { if (await confirmDialog(t("invite.revokeConfirm"), { danger: true })) revoke.mutate(i.id); }}>{t("invite.revoke")}</Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {list.isLoading && <StateBlock kind="loading" title={t("common.loading")} />}
        {list.isError && <StateBlock kind="error" title={t("common.loadFailedShort")} action={() => void list.refetch()} actionLabel={t("common.reload")} />}
        {list.isSuccess && (list.data ?? []).length === 0 && <p className="muted" style={{ fontSize: "var(--text-sm)" }}>{t("invite.empty")}</p>}
        {error && !open && <p className="field-error" role="alert">{error}</p>}
      </Panel>

      {draft.guard}
      <Drawer open={open} title={t("invite.new")} onClose={requestClose} width="sm">
        {error && <p className="field-error" role="alert">{error}</p>}
        {!created ? (
          <div style={{ display: "grid", gap: 12 }}>
            <TextInput label={t("invite.email")} aria-label={t("invite.email")} type="email" value={email}
              onChange={(e) => setEmail(e.target.value)} />
            <Select label={t("invite.project")} ariaLabel={t("invite.project")} value={projectId}
              onChange={(v) => { setProjectId(v); if (!v) setRoleId(""); }} searchable
              options={[{ value: "", label: t("invite.noProject") },
                ...(projects.data ?? []).map((p) => ({ value: p.id, label: `${p.key} ${p.name}` }))]} />
            {projectId && canRole && (
              <Select label={t("invite.projectRole")} ariaLabel={t("invite.projectRole")} value={roleId} onChange={setRoleId} searchable
                options={[{ value: "", label: t("invite.noProjectRole") },
                  ...(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))]} />
            )}
            <p className="muted" style={{ fontSize: "var(--text-xs)", margin: 0 }}>{t("invite.ttl")}</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button variant="ghost" onClick={requestClose} disabled={create.isPending}>{t("common.cancel")}</Button>
              <Button variant="primary" loading={create.isPending} disabled={!email.trim() || create.isPending}
                onClick={() => create.mutate()}>{t("invite.create")}</Button>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <p style={{ margin: 0, fontSize: "var(--text-sm)" }}>{t("invite.once")}</p>
            <p className="muted" style={{ margin: 0, fontSize: "var(--text-xs)" }}>
              {created.emailQueued ? t("invite.emailQueued") : t("invite.emailNotConfigured")}
            </p>
            <code className="invite-link" data-testid="invite-link">{link}</code>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button size="sm" onClick={async () => {
                try { await navigator.clipboard.writeText(link); setCopied(true); setError(null); } catch { setCopied(false); setError(t("common.copyFailed")); }
              }}>{copied ? t("invite.copied") : t("invite.copy")}</Button>
              <Button size="sm" variant="primary" onClick={close}>{t("common.close")}</Button>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
