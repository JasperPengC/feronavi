/** SCIM 2.0 令牌：创建时只显示一次明文，列表只显示前缀/最近使用/撤销。 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, ApiError } from "../../lib/api.ts";
import { t, useLocale } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { SettingsListState, SettingsSection } from "./SettingsSection.tsx";
import type { FeedbackHandlers } from "./types.ts";

interface ScimTokenRow {
  id: string; name: string; tokenPrefix: string; createdBy: string | null;
  lastUsedAt: string | null; revokedAt: string | null; createdAt: string;
}

export function ScimSettings({ onSuccess, onError }: FeedbackHandlers) {
  useLocale();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [plain, setPlain] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["scim-tokens"],
    queryFn: () => apiGet<{ tokens: ScimTokenRow[] }>("/api/v1/scim/tokens").then((r) => r.tokens),
    retry: false,
  });
  const create = useMutation({
    mutationFn: () => apiPost<{ token: string }>("/api/v1/scim/tokens", { name: name.trim() || "SCIM" }),
    onSuccess: async (r) => {
      setPlain(r.token); setName(""); onSuccess(t("se.scimCreated"));
      await qc.invalidateQueries({ queryKey: ["scim-tokens"] });
    },
    onError: (e) => onError(e instanceof ApiError ? e.message : t("se.scimFailed")),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/scim/tokens/${id}`),
    onSuccess: async () => { onSuccess(t("se.scimRevoked")); await qc.invalidateQueries({ queryKey: ["scim-tokens"] }); },
    onError: (e) => onError(e instanceof ApiError ? e.message : t("se.scimFailed")),
  });
  const tokens = list.data ?? [];

  return (
    <SettingsSection title={t("se.scimTitle")} description={t("se.scimDesc")}
      footer={<Button variant="primary" loading={create.isPending} disabled={create.isPending}
        onClick={() => create.mutate()}>{t("se.scimCreate")}</Button>}>
      {list.isLoading && <SettingsListState>{t("common.loading")}</SettingsListState>}
      {list.isError && <SettingsListState tone="error" action={<Button size="sm" onClick={() => void list.refetch()}>{t("common.reload")}</Button>}>{t("se.scimLoadFailed")}</SettingsListState>}
      {plain && (
        <div className="alert alert-success" role="status" style={{ marginBottom: 10 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <strong>{t("se.scimTokenOnce")}</strong>
            <code style={{ overflowWrap: "anywhere", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{plain}</code>
            <div><Button size="sm" variant="ghost" onClick={async () => {
              try { await navigator.clipboard.writeText(plain); onSuccess(t("se.scimCopied")); }
              catch { onError(t("common.copyFailed")); }
            }}>{t("se.scimCopy")}</Button></div>
          </div>
        </div>
      )}
      <TextInput className="settings-field" label={t("se.scimName")} aria-label={t("se.scimName")}
        value={name} onChange={(e) => setName(e.target.value)} />
      {list.isSuccess && tokens.length === 0 && <SettingsListState>{t("se.scimEmpty")}</SettingsListState>}
      {tokens.length > 0 && (
        <ul className="settings-record-list">
          {tokens.map((row) => (
            <li key={row.id}>
              <span className="settings-record-main">
                <strong>{row.name} · <code>{row.tokenPrefix}</code></strong>
                <span className="settings-record-detail">
                  {row.revokedAt ? t("se.scimRevokedLabel") : row.lastUsedAt ? `${t("se.scimLastUsed")} ${new Date(row.lastUsedAt).toLocaleString()}` : t("se.scimNeverUsed")}
                </span>
              </span>
              {!row.revokedAt && <Button size="sm" variant="ghost" loading={revoke.isPending}
                onClick={() => revoke.mutate(row.id)}>{t("se.scimRevoke")}</Button>}
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
