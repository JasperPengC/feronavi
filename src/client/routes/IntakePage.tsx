/**
 * 需求收集（Intake）—— 后端 25 项 e2e 早已就绪，此前**前端零接线**
 *
 * 页面职责：建表单 → 拿到**匿名提交链接**（外部分享）→ 审阅提交队列 → 转成想法 / 拒绝。
 * 纪律：匿名提交端点**不回显提交者身份**（服务端只存哈希），界面也不假装知道是谁提的。
 */
import { useState } from "react";
import { PageTabs, TabPanel } from "../components/ui/PageTabs.tsx";
import { useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHead, EmptyState, Loading } from "../components/Page.tsx";
import { Panel } from "../components/ui/Panel.tsx";
import { MetricCard } from "../components/ui/MetricCard.tsx";
import { toast } from "../components/ui/Toast.tsx";
import { confirmDialog } from "../components/Dialog.tsx";
import { Button } from "../components/ui/Button.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { IntakeFormBuilder } from "../components/intake/IntakeFormBuilder.tsx";
import { apiGet, apiPost, ApiError } from "../lib/api.ts";
import { useCan } from "../lib/actor.ts";
import { t, useLocale, currentLocale } from "../i18n/index.ts";

interface IntakeField { key: string; label: string; type: string; required?: boolean }
interface IntakeForm {
  /** 服务端字段是 `isActive`（不是 enabled）—— 读错会显示成"全部停用" */
  id: string; name: string; schema: IntakeField[]; isActive: boolean;
  submitTokenPrefix?: string; submitToken?: string; createdAt: string;
}
/** 服务端真实返回：`{ items, total }`，字段是 createdAt / convertedIdeaId（不是 submittedAt / convertedWorkItemId） */
interface Submission {
  id: string; formId: string; status: "PENDING" | "CONVERTED" | "REJECTED";
  payload: Record<string, unknown>; createdAt: string; convertedIdeaId?: string | null;
}

const DEFAULT_SCHEMA: IntakeField[] = [
  { key: "title", label: "标题", type: "text", required: true },
  { key: "detail", label: t("it.detail"), type: "textarea" },
];

import { StateBlock } from "../components/ui/StateBlock.tsx";
import { DraftNavigationGuard } from "../components/ui/DraftNavigationGuard.tsx";

export function IntakePage() {
  useLocale();   // 订阅语言，切换即时生效
  const { projectId } = useParams({ from: "/_app/projects/$projectId/intake" });
  const qc = useQueryClient();
  // ⚠️ 后端实际校验的是 idea:manage（不是 intake:manage）—— 前端读错会导致按钮永远不出现
  const canManage = useCan("idea:manage");
  const [section, setSection] = useState("queue");
  const [name, setName] = useState("");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [only, setOnly] = useState<"PENDING" | "CONVERTED" | "REJECTED" | null>("PENDING");

  const forms = useQuery({ queryKey: ["intake-forms", projectId], queryFn: () => apiGet<{ forms: IntakeForm[] }>(`/api/v1/projects/${projectId}/intake-forms`) });
  const subs = useQuery({
    queryKey: ["intake-subs", projectId, only],
    queryFn: () => apiGet<{ items: Submission[]; total: number }>(`/api/v1/projects/${projectId}/intake-submissions${only ? `?status=${only}` : ""}`),
  });

  const create = useMutation({
    mutationFn: () => apiPost<{ form: IntakeForm; submitToken: string }>(`/api/v1/projects/${projectId}/intake-forms`, { name, schema: DEFAULT_SCHEMA }),
    onSuccess: async (r) => {
      setName("");
      /**
       * ⚠️ 响应形状是 `{ form: {...}, submitToken }` —— **令牌在顶层、表单在嵌套里**。
       * 我先按 `form.submitToken` 读（猜的），结果链接永远不显示；实测打印完整响应才确认。
       * 教训：形状靠猜必错，宁可多打一次响应。
       */
      if (r.submitToken) setToken(r.submitToken);
      await qc.invalidateQueries({ queryKey: ["intake-forms", projectId] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("it.createFailed")),
  });
  const rotate = useMutation({
    mutationFn: (id: string) => apiPost<{ submitToken: string }>(`/api/v1/intake-forms/${id}/rotate-token`, {}),
    onSuccess: (r) => setToken(r.submitToken),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("it.createFailed")),
  });
  const convert = useMutation({
    mutationFn: (id: string) => apiPost(`/api/v1/intake-submissions/${id}/convert`, {}),
    onSuccess: async () => { await Promise.all([
      qc.invalidateQueries({ queryKey: ["intake-subs", projectId] }),
      qc.invalidateQueries({ queryKey: ["ideas", projectId] }),
    ]); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("it.convertFailed")),
  });
  const reject = useMutation({
    mutationFn: (id: string) => apiPost(`/api/v1/intake-submissions/${id}/reject`, {}),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["intake-subs", projectId] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("it.rejectFailed")),
  });

  const formList = forms.data?.forms ?? [];
  const rows = subs.data?.items ?? [];
  const pending = rows.filter((r) => r.status === "PENDING").length;

  return (
    <div className="page project-refinement intake-page">
      <PageHead title={t("intake.title")} />
      <PageTabs id="intake" label={t("intake.title")} value={section} onChange={setSection} tabs={[
        { value: "queue", label: t("intake.queue") }, { value: "forms", label: t("sections.forms") },
      ]} />
      {token && (
        <div className="alert alert-info">
          {t("it.anonLink")}<a className="mono" href={`/intake/${token}`} target="_blank" rel="noreferrer">/intake/{token}</a>
          <br />
          <span className="muted" style={{ fontSize: "var(--text-xs)" }}>
            {t("it.anonHint")}
          </span>
        </div>
      )}

      <IntakeFormBuilder open={builderOpen} projectId={projectId!} onClose={() => setBuilderOpen(false)}
        onCreated={(tok) => setToken(tok)} />

      <TabPanel tabsId="intake" value="queue" activeValue={section}>
      <div className="metric-grid metric-grid-3" style={{ marginBottom: 16 }}>
        <MetricCard label={t("it.forms")} value={formList.length} tone="primary" />
        <MetricCard label={t("it.mListed")} value={rows.length} />
        <MetricCard label={t("it.pending")} value={pending} tone={pending > 0 ? "warning" : "neutral"} />
      </div>

      {subs.isLoading ? <Loading /> : subs.isError ? <StateBlock kind="error" title={t("it.queueFailed")} action={() => void subs.refetch()} actionLabel={t("common.reload")} /> : (
          <Panel
            title={t("intake.queue")}
            actions={
              <div className="ui-segmented" role="group" aria-label={t("common.status")}>
                {(["PENDING", "CONVERTED", "REJECTED"] as const).map((s) => (
                  <button type="button" className="ui-segmented-item" key={s} aria-pressed={only === s} onClick={() => setOnly(s)}>
                    {s === "PENDING" ? t("it.pending") : s === "CONVERTED" ? t("it.converted") : t("it.rejected")}
                  </button>
                ))}
                <button type="button" className="ui-segmented-item" aria-pressed={only === null} onClick={() => setOnly(null)}>{t("it.all")}</button>
              </div>
            }
          >
            {rows.length === 0 && (
              <EmptyState
                title={only === "PENDING" ? t("it.emptyPending") : t("it.emptyAll")}
                hint={formList.length === 0 ? t("it.emptyFormsHint") : t("it.emptySubsHint")}
                action={canManage && formList.length === 0 ? <Button onClick={() => setSection("forms")}>{t("it.newForm")}</Button> : undefined}
              />
            )}
            <ul className="side-list">
              {rows.map((s) => (
                <li key={s.id} style={{ alignItems: "flex-start" }}>
                  <span className="side-dot" />
                  <span className="side-text" style={{ whiteSpace: "normal" }}>
                    <strong>{String(s.payload.title ?? s.payload["标题"] ?? t("it.untitled2"))}</strong>
                    {typeof (s.payload.detail ?? s.payload["详细描述"]) === "string" && (
                      <div className="muted" style={{ fontSize: "var(--text-xs)" }}>
                        {String(s.payload.detail ?? s.payload["详细描述"]).slice(0, 120)}
                      </div>
                    )}
                    <details className="intake-submission-details"><summary>{t("it.detail")}</summary><dl>
                      {Object.entries(s.payload).map(([key, value]) => <div key={key}><dt>{formList.find(form => form.id === s.formId)?.schema.find(field => field.key === key)?.label ?? key}</dt><dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd></div>)}
                    </dl></details>
                    <span className="muted" style={{ fontSize: "var(--text-xs)" }}>
                      {new Date(s.createdAt).toLocaleString(currentLocale())}
                      {s.convertedIdeaId ? t("it.convertedPipe") : ""}
                    </span>
                  </span>
                  {s.status === "PENDING" && canManage && (
                    <span style={{ display: "flex", gap: 6, flex: "none" }}>
                      <Button size="sm" disabled={convert.isPending || reject.isPending} onClick={() => convert.mutate(s.id)}>{t("it.convert")}</Button>
                      <Button size="sm" variant="ghost" disabled={convert.isPending || reject.isPending} onClick={() => reject.mutate(s.id)}>{t("it.reject")}</Button>
                    </span>
                  )}
                  {s.status !== "PENDING" && <span className="tag">{s.status === "CONVERTED" ? t("it.convertedShort") : t("it.rejected")}</span>}
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </TabPanel>
      <TabPanel tabsId="intake" value="forms" activeValue={section}>
        {canManage && <div className="intake-create-actions">
          <TextInput label={t("intake.formNameLabel")} placeholder={t("intake.formNamePlaceholder")}
            value={name} onChange={event => setName(event.target.value)} />
          <Button variant="primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>{t("it.newForm")}</Button>
          <Button onClick={() => setBuilderOpen(true)}>{t("it.design")}</Button>
        </div>}
          <Panel title={t("intake.forms")} className="intake-forms-summary">
            {forms.isLoading && <Loading />}
            {forms.isError && <StateBlock kind="error" title={t("common.loadFailedShort")} action={() => void forms.refetch()} actionLabel={t("common.reload")} />}
            {forms.isSuccess && formList.length === 0 && <p className="muted" style={{ fontSize: "var(--text-sm)", margin: 0 }}>{t("it.noForms")}</p>}
            <ul className="side-list">
              {formList.map((f) => (
                <li key={f.id}>
                  <span className="side-dot" />
                  <span className="side-text">{f.name}<small className="muted">{t("it.fieldCount", { n: String(f.schema.length) })} · {f.isActive ? t("it.active") : t("it.inactive")}</small></span>
                  {canManage && <Button size="sm" variant="ghost" onClick={async () => {
                    if (await confirmDialog(t("it.shareConfirm"))) rotate.mutate(f.id);
                  }} disabled={rotate.isPending}>{t("it.share")}</Button>}
                </li>
              ))}
            </ul>
            <p className="muted" style={{ fontSize: "var(--text-xs)", marginBottom: 0, marginTop: 10 }}>
              {t("it.formDefaults")}
            </p>
          </Panel>
      </TabPanel>
      <DraftNavigationGuard dirty={!!name.trim()} saving={create.isPending} message={t("flows.discardDraft")} />
    </div>
  );
}
