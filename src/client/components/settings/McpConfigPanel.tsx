/** MCP 接入配置：自托管地址 + API Key，生成可直接粘贴的客户端配置。 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { useCan } from "../../lib/actor.ts";
import { Button } from "../ui/Button.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { SettingsSection } from "./SettingsSection.tsx";
import { toast } from "../ui/Toast.tsx";

export function McpConfigPanel({ defaultApiKey = "" }: { defaultApiKey?: string }) {
  const qc = useQueryClient();
  const canManage = useCan("setting:manage");
  const config = useQuery({ queryKey: ["mcp-config"], queryFn: () => apiGet<{ url: string }>("/api/v1/mcp/config"), retry: false });
  const fallback = typeof window !== "undefined" ? `${window.location.origin}/api/v1/mcp` : "https://feronavi.example.com/api/v1/mcp";
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState(defaultApiKey);
  useEffect(() => { if (config.data) setUrl(config.data.url || fallback); }, [config.data, fallback]);
  useEffect(() => { if (defaultApiKey) setApiKey(defaultApiKey); }, [defaultApiKey]);

  const save = useMutation({
    mutationFn: () => apiPut<{ url: string }>("/api/v1/mcp/config", { url: url.trim() }),
    onSuccess: async () => { toast.success(t("se.mcpConfigSaved")); await qc.invalidateQueries({ queryKey: ["mcp-config"] }); },
    onError: (e) => toast.error((e as Error).message || t("se.mcpConfigSaveFailed")),
  });

  const snippet = JSON.stringify({
    mcpServers: {
      feronavi: {
        url: url.trim() || fallback,
        headers: { Authorization: `Bearer ${apiKey || "<API_KEY>"}` },
      },
    },
  }, null, 2);

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(t("common.copyDone")); }
    catch { toast.error(t("common.copyFailed")); }
  };

  return (
    <SettingsSection title={t("se.mcpConfigTitle")} description={t("se.mcpConfigHint")}
      footer={canManage ? <Button variant="primary" loading={save.isPending} disabled={!url.trim() || save.isPending} onClick={() => save.mutate()}>{t("common.save")}</Button> : undefined}>
      <div className="mcp-config-grid">
        <TextInput label={t("se.mcpEndpoint")} placeholder="https://your-host/api/v1/mcp"
          value={url} onChange={(e) => setUrl(e.target.value)} hint={t("se.mcpEndpointHint")} />
        <TextInput label={t("se.mcpApiKey")} type="password" placeholder={t("se.mcpApiKeyHint")}
          value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      </div>
      <div className="mcp-config-snippet">
        <div className="mcp-config-snippet-head">
          <strong>{t("se.mcpConfigSnippet")}</strong>
          <Button size="sm" onClick={() => void copy(snippet)}>{t("common.copy")}</Button>
        </div>
        <pre>{snippet}</pre>
      </div>
    </SettingsSection>
  );
}
