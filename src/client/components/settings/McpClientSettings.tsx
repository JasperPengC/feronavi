/**
 * MCP 客户端与工具级策略（Round 25 长任务第 26 项）
 *
 * 后端第 25 轮已落地 `mcp_client` / `mcp_tool_policy` 与端点；本组件是它的管理界面：
 *   · 列表：令牌名/档位/客户端名与版本/调用次数/最后活跃/当前策略；
 *   · 策略编辑：**整体替换**（与后端 PUT 语义一致）——每行工具名 + ALLOW/DENY；
 *   · 明确提示：DENY 优先于令牌档位；保存后立即生效（下一次工具调用即被拦截）。
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut, ApiError } from "../../lib/api.ts";
import { t, useLocale } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { Modal } from "../ui/Modal.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { Select } from "../Select.tsx";
import { SettingsListState, SettingsSection } from "./SettingsSection.tsx";
import type { FeedbackHandlers } from "./types.ts";

interface PolicyRow { toolName: string; effect: "ALLOW" | "DENY"; argConstraints?: Record<string, unknown> }
interface ClientRow {
  id: string; tokenId: string; tokenName: string; tier: string;
  clientName: string | null; clientVersion: string | null;
  lastSeenAt: string | null; callCount: number; policies: PolicyRow[];
}

import { useSettingsDraft } from "./SettingsDraft.tsx";

export function McpClientSettings({ onSuccess }: FeedbackHandlers) {
  useLocale();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["mcp-clients"],
    queryFn: () => apiGet<{ clients: ClientRow[] }>("/api/v1/mcp-clients"),
    retry: false,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PolicyRow[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [newTool, setNewTool] = useState("");
  const [newEffect, setNewEffect] = useState<"ALLOW" | "DENY">("DENY");

  const save = useMutation({
    mutationFn: (clientId: string) => apiPut(`/api/v1/mcp-clients/${clientId}/policy`, {
      policies: draft.map((p) => ({ toolName: p.toolName, effect: p.effect })),
    }),
    onSuccess: async () => {
      setEditingId(null);
      setFormError(null);
      setDraft([]);
      setNewTool("");
      onSuccess(t("se.mcpSaved"));
      await qc.invalidateQueries({ queryKey: ["mcp-clients"] });
    },
    onError: (e) => setFormError(e instanceof ApiError ? e.message : t("se.mcpSaveFailed")),
  });

  const guard = useSettingsDraft(!!editingId, { draft, newTool, newEffect }, save.isPending);
  const startEdit = (c: ClientRow) => {
    void guard.leave(() => {
    setEditingId(c.id);
    setFormError(null);
    setDraft(c.policies.map((p) => ({ ...p })));
    setNewTool("");
    setNewEffect("DENY");
    guard.markSaved({ draft: c.policies.map(p => ({ ...p })), newTool: "", newEffect: "DENY" });
    });
  };
  const addPolicy = () => {
    const tool = newTool.trim();
    if (!tool || draft.some((p) => p.toolName === tool)) return;
    setDraft((d) => [...d, { toolName: tool, effect: newEffect }]);
    setNewTool("");
  };

  const requestClose = () => void guard.leave(() => { setEditingId(null); setFormError(null); });

  return (
    <SettingsSection title={t("set.mcpClients")} description={t("se.mcpDesc")}>
      {guard.guard}
      {list.isLoading && <SettingsListState>{t("common.loading")}</SettingsListState>}
      {list.isError && <SettingsListState tone="error" action={<Button size="sm" onClick={() => void list.refetch()}>{t("common.reload")}</Button>}>{t("se.mcpLoadFailed")}</SettingsListState>}
      {list.data && list.data.clients.length === 0 && <SettingsListState>{t("se.mcpEmpty")}</SettingsListState>}
      {!!list.data?.clients.length && (
        <ul className="settings-record-list">
          {list.data.clients.map((c) => (
            <li key={c.id}>
              <span className="settings-record-main">
                <strong>{c.tokenName}</strong>
                <span className="settings-record-detail">
                  {c.tier} · {c.clientName ?? t("se.mcpUnknownClient")}{c.clientVersion ? ` v${c.clientVersion}` : ""}
                  {" · "}{t("se.mcpCalls", { n: String(c.callCount) })}
                  {c.lastSeenAt ? ` · ${t("se.mcpLastSeen")} ${new Date(c.lastSeenAt).toLocaleString()}` : ""}
                </span>
                <span className="settings-record-detail">
                  {c.policies.length === 0 ? t("se.mcpNoPolicy") : c.policies.map((p) => `${p.toolName}=${p.effect}`).join("，")}
                </span>
              </span>
              <Button size="sm" variant="ghost" aria-haspopup="dialog" onClick={() => startEdit(c)}>{t("se.mcpEdit")}</Button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!editingId} width="lg" title={t("se.mcpPolicies")} onClose={requestClose}
        footer={<>
          <Button disabled={save.isPending} onClick={requestClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={save.isPending || !editingId} loading={save.isPending} onClick={() => { if (editingId && !save.isPending) { setFormError(null); save.mutate(editingId); } }}>{t("se.mcpSave")}</Button>
        </>}>
        {formError && <p className="field-error" role="alert">{formError}</p>}
        <fieldset disabled={save.isPending} className="settings-form-fields">
                  {draft.length === 0 && <SettingsListState>{t("se.mcpNoPolicy")}</SettingsListState>}
                  {draft.length > 0 && (
                    <ul className="settings-delivery-list">
                      {draft.map((p) => (
                        <li key={p.toolName}>
                          <code className="mono">{p.toolName}</code>
                          <span className={p.effect === "DENY" ? "tag tag-danger" : "tag tag-success"}>{p.effect}</span>
                          <Button size="sm" variant="ghost" onClick={() => setDraft((d) => d.filter((x) => x.toolName !== p.toolName))}>
                            {t("se.mcpRemove")}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="settings-form-inline" style={{ marginTop: 8 }}>
                    <TextInput className="settings-field" label={t("se.mcpTool")} placeholder="work_item.delete"
                      value={newTool} aria-label={t("se.mcpTool")} onChange={(e) => setNewTool(e.target.value)} />
                    <Select className="settings-field" label={t("se.mcpEffect")} ariaLabel={t("se.mcpEffect")}
                      value={newEffect} onChange={(v) => setNewEffect(v as "ALLOW" | "DENY")}
                      options={[{ value: "DENY", label: "DENY" }, { value: "ALLOW", label: "ALLOW" }]} />
                    <Button size="sm" variant="ghost" disabled={!newTool.trim()} onClick={addPolicy}>{t("se.mcpAddPolicy")}</Button>
                  </div>
        </fieldset>
      </Modal>
    </SettingsSection>
  );
}
