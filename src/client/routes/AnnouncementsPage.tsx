/** 公告：群发（最高风险写操作，需 notification:send）+ 撤回（仅限本人） */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHead, PageGrid, EmptyState, Loading } from "../components/Page.tsx";
import { Panel } from "../components/ui/Panel.tsx";
import { MetricCard } from "../components/ui/MetricCard.tsx";
import { toast } from "../components/ui/Toast.tsx";
import { apiGet, apiPost, ApiError } from "../lib/api.ts";
import { useActor, useCan } from "../lib/actor.ts";
import { t, useLocale, currentLocale } from "../i18n/index.ts";
import { Select } from "../components/Select.tsx";
import { Button } from "../components/ui/Button.tsx";
import { confirmDialog } from "../components/Dialog.tsx";
import { TextArea } from "../components/ui/TextArea.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { Icon } from "../components/Icon.tsx";
import { Modal } from "../components/ui/Modal.tsx";
import { relativeTime } from "../lib/time.ts";
import { useSettingsDraft } from "../components/settings/SettingsDraft.tsx";
import { StateBlock } from "../components/ui/StateBlock.tsx";

interface Ann {
  id: string; title: string; body: string; severity: "INFO" | "WARNING" | "CRITICAL";
  deliveredCount: number; revokedAt: string | null; createdAt: string; authorId: string;
}
/** 严重级别标签走词典（渲染时翻译，字典存键不留中文） */
const SEV: Record<string, string> = { INFO: "ann.sevInfo", WARNING: "ann.sevWarning", CRITICAL: "ann.sevCritical" };

export function AnnouncementsPage() {
  useLocale();   // 订阅语言，切换即时生效
  const qc = useQueryClient();
  const actor = useActor();
  const [formError, setFormError] = useState<string | null>(null);
  const canSend = useCan("notification:send");
  const [form, setForm] = useState({ title: "", body: "", severity: "INFO" as Ann["severity"] });
  const [confirming, setConfirming] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  const list = useQuery({ queryKey: ["announcements"], queryFn: () => apiGet<{ announcements: Ann[] }>("/api/v1/announcements") });
  const send = useMutation({
    mutationFn: () => apiPost("/api/v1/announcements", form),
    onSuccess: async () => {
      setForm({ title: "", body: "", severity: "INFO" }); setConfirming(false); setComposeOpen(false);
      await qc.invalidateQueries({ queryKey: ["announcements"] });
    },
    // 操作失败 → toast；**校验清单（下方 118 行）保留 inline**，因为它要逐条列出问题
    onError: (e) => setFormError(e instanceof ApiError ? e.message : t("ann.sendFailed")),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiPost(`/api/v1/announcements/${id}/revoke`, {}),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("ann.sendFailed")),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["announcements"] }); },
  });

  const draft = useSettingsDraft(composeOpen, form, send.isPending);
  const requestClose = () => void draft.leave(() => { setComposeOpen(false); setForm({ title: "", body: "", severity: "INFO" }); setFormError(null); });
  const items = list.data?.announcements ?? [];

  return (
    <div className="page collection-page announcements-page">
      <PageHead title={t("ann.title")}
        actions={canSend ? <Button variant="primary" onClick={() => { setConfirming(false); setComposeOpen(true); }}><Icon name="megaphone" size={14} />{t("ann.compose")}</Button> : undefined} />
      {/* 密度：公告页填充率 0.76、留白 169px（离阈值最近）—— 用**真实数据**铺一层指标。
          只用已有词典键；计数按 severity 分组。 */}
      {items.length > 0 && (() => {
        const warn = items.filter((a) => a.severity === "WARNING").length;
        const critical = items.filter((a) => a.severity === "CRITICAL").length;
        return (
          <div className="metric-grid metric-grid-3">
            <MetricCard label={t("ann.sevInfo")} value={String(items.length - warn - critical)} tone="primary" />
            <MetricCard label={t("ann.sevWarning")} value={String(warn)} tone="warning" />
            <MetricCard label={t("ann.sevCritical")} value={String(critical)} tone="warning" />
          </div>
        );
      })()}

      <PageGrid
        main={list.isLoading ? <Loading /> : list.isError ? <StateBlock kind="error" title={t("ann.loadFailed")} action={() => void list.refetch()} actionLabel={t("common.reload")} /> : items.length === 0
          ? <Panel><EmptyState title={t("ann.empty")} hint={t("ann.emptyHint")} /></Panel>
          : items.map((a) => (
            <Panel key={a.id} className="announcement-record">
              <div className="announcement-record-head">
                <strong>{a.title}</strong>
                <span className={`status-pill ${a.severity === "CRITICAL" ? "dot-red" : a.severity === "WARNING" ? "dot-amber" : "dot-blue"}`}>{t(SEV[a.severity] ?? "ann.sevInfo")}</span>
                {a.revokedAt && <span className="status-pill dot-red">{t("ann.revoked")}</span>}
                <span className="muted announcement-record-meta">
                  <span title={new Date(a.createdAt).toLocaleString(currentLocale())}>{relativeTime(a.createdAt)}</span> ｜ {t("ann.delivered")} {a.deliveredCount} {t("ann.people")}
                </span>
              </div>
              <p className="announcement-record-body">{a.body}</p>
              {!a.revokedAt && canSend && a.authorId === actor.memberId && (
                <div style={{ marginTop: 10 }}>
                  <Button size="sm" variant="ghost" disabled={revoke.isPending} onClick={async () => { if (await confirmDialog(t("ann.revokeConfirm"), { danger: true })) revoke.mutate(a.id); }} title={t("ann.revokeHint")}>{t("ann.revoke")}</Button>
                </div>
              )}
            </Panel>
          ))}
      />

      {draft.guard}
      <Modal open={composeOpen} title={t("ann.compose")} onClose={requestClose}
        footer={!confirming ? (
          <>
            <Button onClick={requestClose}>{t("ann.cancel")}</Button>
            <Button variant="primary" disabled={!form.title.trim() || !form.body.trim()}
              onClick={() => setConfirming(true)}><Icon name="megaphone" size={14} />{t("ann.sendAll")}</Button>
          </>
        ) : (
          <>
            <Button disabled={send.isPending} onClick={() => setConfirming(false)}>{t("ann.cancel")}</Button>
            <Button variant="primary" loading={send.isPending} disabled={send.isPending} onClick={() => send.mutate()}>
              <Icon name="send" size={14} />{send.isPending ? t("ann.sending") : t("ann.confirmSend")}
            </Button>
          </>
        )}>
        {formError && <p className="field-error" role="alert">{formError}</p>}
        <fieldset disabled={send.isPending} className="settings-form-fields">
        <div style={{ display: "grid", gap: 12 }}>
          {confirming && <div className="alert alert-error" role="alert">{t("ann.confirmWarn")}</div>}
          <TextInput id="a-title" label={t("ann.fTitle")} value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <TextArea id="a-body" label={t("ann.fBody")} rows={6} value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })} />
          <Select label={t("ann.fSeverity")} value={form.severity} ariaLabel={t("ann.fSeverity")}
            onChange={(v) => setForm({ ...form, severity: v as typeof form.severity })}
            options={[
              { value: "INFO", label: t("ann.sevInfo") },
              { value: "WARNING", label: t("ann.sevWarning") },
              { value: "CRITICAL", label: t("ann.sevCritical") },
            ]} />
        </div>
        </fieldset>
      </Modal>
    </div>
  );
}
