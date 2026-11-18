import { TableScroll } from "../components/ui/TableScroll.tsx";
/**
 * API 令牌管理（第六期）：创建 / 列表 / 吊销 + MCP 接入说明
 *
 * 两个刻意的设计：
 *   1 明文令牌**只在创建后显示一次**，且用醒目提示要求立刻保存（服务端不留明文）
 *   2 页面直接给出 MCP 接入片段 —— 令牌的用途就是接 AI 客户端，藏起来等于没做完
 */
import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tokens, type TokenRow } from "../lib/tokens-api.ts";
import { apiGet, ApiError } from "../lib/api.ts";
import { t as tr, useLocale } from "../i18n/index.ts";   // ⚠️ 本文件里 t 是 TokenRow 行对象，i18n 的 t 必须别名
import { DatePicker } from "../components/DatePicker.tsx";
import { toast } from "../components/ui/Toast.tsx";
import { Button } from "../components/ui/Button.tsx";
import { ConfirmButton } from "../components/ui/ConfirmButton.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { Select } from "../components/Select.tsx";
import { relativeTime } from "../lib/time.ts";
import { Icon } from "../components/Icon.tsx";
import { PageTabs, TabPanel } from "../components/ui/PageTabs.tsx";
import { PageHead } from "../components/Page.tsx";
import { Modal } from "../components/ui/Modal.tsx";
import { StateBlock } from "../components/ui/StateBlock.tsx";
import { DraftNavigationGuard } from "../components/ui/DraftNavigationGuard.tsx";
import { confirmDialog } from "../components/Dialog.tsx";
import { McpClientSettings } from "../components/settings/McpClientSettings.tsx";
import { McpConfigPanel } from "../components/settings/McpConfigPanel.tsx";

const TIER_LABEL: Record<string, string> = {
  // 档位标签走词典（字典存键，渲染时翻译）
  READ_ONLY: "token.tierReadOnly",
  READ_WRITE: "token.tierReadWrite",
  ADMIN: "token.tierAdmin",
};

export function TokensPage() {
  useLocale();   // 订阅语言，切换即时生效
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [tier, setTier] = useState("READ_ONLY");
  const [expiresAt, setExpiresAt] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [tab, setTab] = useState<"tokens" | "mcp">("tokens");
  const formId = useId();
  const confirming = useRef(false);
  const dirty = !!(name || expiresAt || tier !== "READ_ONLY");

  const list = useQuery({ queryKey: ["tokens"], queryFn: tokens.list });

  const create = useMutation({
    mutationFn: () => tokens.create({ name, tier, expiresAt: expiresAt || null }),
    onSuccess: async (r) => {
      setPlaintext(r.token);
      setCreateOpen(false);
      setName(""); setExpiresAt(""); setTier("READ_ONLY");
      await qc.invalidateQueries({ queryKey: ["tokens"] });
    },
    // 操作失败 → toast（页面级 alert 会把整页顶下去、且填写内容被挤走）
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tr("token.createFailed")),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => tokens.revoke(id),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["tokens"] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tr("token.revokeFailed")),
  });

  const rows: TokenRow[] = list.data ?? [];
  const closeCreate = async () => {
    if (create.isPending || confirming.current) return;
    confirming.current = true;
    try {
      if (dirty && !await confirmDialog(tr("flows.discardDraft"))) return;
      setCreateOpen(false); setName(""); setExpiresAt(""); setTier("READ_ONLY"); create.reset();
    } finally { confirming.current = false; }
  };
  const mcpConfig = useQuery({ queryKey: ["mcp-config"], queryFn: () => apiGet<{ url: string }>("/api/v1/mcp/config"), retry: false });
  const mcpEndpoint = mcpConfig.data?.url || `${typeof window !== "undefined" ? window.location.origin : "https://feronavi.example.com"}/api/v1/mcp`;
  const mcpBase = mcpEndpoint.replace(/\/api\/v1\/mcp\/?$/, "");
  const mcpSnippet = plaintext
    ? `# 推荐：任意 MCP 客户端（Claude Desktop / Cursor / VS Code / Windsurf / Cline）
npx -y feronavi-mcp --url ${mcpBase} --token ${plaintext}

# 生成客户端配置
npx -y feronavi-mcp --print-config --client cursor --url ${mcpBase} --token ${plaintext}

# 或直接走 Streamable-HTTP
Authorization: Bearer ${plaintext}
POST ${mcpEndpoint}`
    : "";

  return (
    <div className={`page tokens-page${tab === "tokens" ? " data-page" : ""}`}>
      <PageHead title={tr("token.title")}
        actions={tab === "tokens" ? <Button variant="primary" onClick={() => setCreateOpen(true)}><Icon name="plus" size={14} />{tr("token.new")}</Button> : undefined} />

      <PageTabs id="tokens" label={tr("token.title")} value={tab} onChange={setTab}
        tabs={[{ value: "tokens", label: tr("token.tabTokens") }, { value: "mcp", label: tr("token.tabMcp") }]} />

      <TabPanel tabsId="tokens" value="tokens" activeValue={tab}>
      {/* 明文只显示一次 */}
      {plaintext && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <strong style={{ fontSize: "var(--text-sm)" }}>{tr("token.created")}</strong>
          <p className="muted" style={{ fontSize: "var(--text-xs)", margin: "6px 0 10px" }}>
            {tr("token.secretHint")}<strong>{tr("token.secretHintStrong")}</strong>{tr("token.secretHintTail")}
          </p>
          <pre data-custom-scroll style={{
            padding: 12, borderRadius: "var(--radius-sm)", background: "var(--surface-raised)",
            fontSize: "var(--text-xs)", overflowX: "auto", margin: "0 0 10px",
          }}>{plaintext}</pre>
          <details>
            <summary style={{ cursor: "pointer", fontSize: "var(--text-sm)" }}>{tr("token.mcpHow")}</summary>
            <pre data-custom-scroll style={{
              padding: 12, marginTop: 8, borderRadius: "var(--radius-sm)", background: "var(--surface-raised)",
              fontSize: "var(--text-xs)", overflowX: "auto",
            }}>{mcpSnippet}</pre>
          </details>
          <Button size="sm" style={{ marginTop: 10 }} onClick={() => setPlaintext(null)}>{tr("token.saved")}</Button>
        </div>
      )}

      {/* 列表 */}
      <div className="card token-table-card data-fill">
      <div className="token-table-head">
        <strong>{tr("token.listTitle")}</strong>
        {list.isSuccess && <span className="muted">{rows.length} {tr("token.countUnit")}</span>}
      </div>
      {list.isLoading && <StateBlock kind="loading" title={tr("common.loading")} />}
      {list.isError && <StateBlock kind="error" title={tr("token.loadFailed")} action={() => void list.refetch()} actionLabel={tr("common.reload")} />}
      {list.isSuccess && <>
      <TableScroll label={tr("token.listTitle")}>
        <table className="token-table token-table-responsive">
        <thead>
          <tr>
            {/* 用途与令牌前缀合并为第一列（外壳重做第 23 轮）：行改表头必须同步，否则错位 */}
            <th>{tr("token.colPurpose")}</th>
            <th>{tr("token.colTier")}</th>
            <th>{tr("token.colLastUsed")}</th>
            <th>{tr("token.colExpires")}</th>
            <th className="table-actions">{tr("common.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="row-hover">
              <td data-label={tr("token.colPurpose")}>
                <div className="row-title">
                  <span className="row-avatar" aria-hidden="true"><Icon name="key" size={13} /></span>
                  <span className="row-name">{t.name}</span>
                </div>
                <div className="row-sub"><span className="mono">{t.tokenPrefix}</span></div>
              </td>
              <td data-label={tr("token.colTier")}>
                <span className={`status-pill ${t.tier === "READ_ONLY" ? "dot-green" : t.tier === "ADMIN" ? "dot-red" : "dot-blue"}`}>
                  {tr(TIER_LABEL[t.tier] ?? t.tier)}
                </span>
              </td>
              <td data-label={tr("token.colLastUsed")} className="muted" title={t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : undefined}>{relativeTime(t.lastUsedAt)}</td>
              <td data-label={tr("token.colExpires")} className="muted" title={t.expiresAt ? new Date(t.expiresAt).toLocaleString() : undefined}>{t.expiresAt ? relativeTime(t.expiresAt) : tr("token.neverExpires")}</td>
              <td data-label={tr("common.actions")} style={{ textAlign: "right" }}>
                <ConfirmButton size="sm" disabled={revoke.isPending} confirmText={tr("common.confirmRevoke")} onConfirm={() => revoke.mutate(t.id)}><Icon name="trash" size={13} />{tr("token.revoke")}</ConfirmButton>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={5} style={{ padding: 32, textAlign: "center" }} className="muted">
              {tr("token.empty")}
            </td></tr>
          )}
        </tbody>
      </table>
        </TableScroll>
      </>}
      </div>
      </TabPanel>

      <TabPanel tabsId="tokens" value="mcp" activeValue={tab} className="page-tab-panel--stack">
          <McpConfigPanel defaultApiKey={plaintext ?? ""} />
          <McpClientSettings onSuccess={(m) => toast.success(m)} onError={(m) => toast.error(m)} />
      </TabPanel>

      <DraftNavigationGuard dirty={createOpen && dirty} saving={create.isPending} message={tr("flows.discardDraft")} />
      <Modal open={createOpen} title={tr("token.new")} onClose={() => void closeCreate()}
        footer={<>
          <Button disabled={create.isPending} onClick={() => void closeCreate()}>{tr("common.cancel")}</Button>
          <Button type="submit" form={formId} variant="primary" loading={create.isPending} disabled={!name.trim() || create.isPending}>{tr("token.create")}</Button>
        </>}>
        <form id={formId} onSubmit={(event) => { event.preventDefault(); if (name.trim() && !create.isPending) create.mutate(); }}>
        <fieldset disabled={create.isPending} className="task-form-fields">
          <TextInput id="token-name" label={tr("token.nameLabel")} placeholder={tr("token.namePlaceholder")}
            value={name} onChange={(e) => setName(e.target.value)} />
          <Select label={tr("token.tierLabel")} value={tier} ariaLabel={tr("token.tierLabel")} onChange={setTier}
            options={[
              { value: "READ_ONLY", label: tr("token.tierReadOnly") },
              { value: "READ_WRITE", label: tr("token.tierReadWriteFull") },
              { value: "ADMIN", label: tr("token.tierAdminFull") },
            ]} />
          <DatePicker label={tr("token.expiresLabel")} value={expiresAt} onChange={setExpiresAt} ariaLabel={tr("token.expiresLabel")}
            placeholder={tr("common.pickDate")} />
          <p className="muted" style={{ margin: 0, fontSize: "var(--text-xs)" }}>{tr("token.newHint")}</p>
          {create.isError && <p className="field-error" role="alert">{create.error instanceof ApiError ? create.error.message : tr("token.createFailed")}</p>}
        </fieldset>
        </form>
      </Modal>
    </div>
  );
}
