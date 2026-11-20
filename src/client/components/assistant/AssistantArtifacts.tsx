import { useEffect, useId, useState } from "react";
import { Icon } from "../Icon.tsx";
import { Select } from "../Select.tsx";
import { Button } from "../ui/Button.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { apiDelete, apiPost, apiUpload, ApiError } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import type { RagProject, RagReferences } from "../../../shared/rag.ts";

type Kind = "GITHUB" | "GITLAB" | "GITEE";
const services: Record<Kind, { name: string; url: string }> = {
  GITHUB: { name: "GitHub", url: "https://api.github.com" },
  GITLAB: { name: "GitLab", url: "https://gitlab.com" },
  GITEE: { name: "Gitee", url: "https://gitee.com" },
};
export interface AssistantArtifactSelection {
  id: string; type: "file" | "credential"; label: string; projectId: string; expiresAt: string;
}
export function assistantArtifactReferences(value: AssistantArtifactSelection[], now = Date.now()): RagReferences {
  const live = value.filter(item => Date.parse(item.expiresAt) > now);
  const artifactIds = live.filter(item => item.type === "file").map(item => item.id);
  const credentialRefs = live.filter(item => item.type === "credential").map(item => item.id);
  return { ...(artifactIds.length ? { artifactIds } : {}), ...(credentialRefs.length ? { credentialRefs } : {}) };
}

/** 文件与秘密直传专用端点；聊天正文只发送结构化引用。 */
export function AssistantArtifacts({ projects, scopeProject, value, onChange, onRefsChange, disabled = false }: {
  projects: RagProject[]; scopeProject?: string; value: AssistantArtifactSelection[];
  onChange: (value: AssistantArtifactSelection[]) => void; onRefsChange: (references: RagReferences) => void; disabled?: boolean;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [credential, setCredential] = useState(false);
  const [projectId, setProjectId] = useState(scopeProject ?? "");
  useEffect(() => { if (scopeProject) setProjectId(scopeProject); }, [scopeProject]);
  const [kind, setKind] = useState<Kind>("GITHUB");
  const [baseUrl, setBaseUrl] = useState(services.GITHUB.url);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { onRefsChange(assistantArtifactReferences(value, now)); }, [value, now, onRefsChange]);
  const blocked = disabled || busy;
  const availableProjects = projects.filter(project => !project.archived);
  const targetValid = !!projectId && availableProjects.some(project => project.id === projectId) && (!scopeProject || scopeProject === projectId);
  const atLimit = (type: AssistantArtifactSelection["type"]) => value.filter(item => item.type === type && Date.parse(item.expiresAt) > now).length >= 10;
  function failure(cause: unknown) { setError(cause instanceof ApiError ? cause.message : t("assistant.artifacts.failed")); }
  async function upload(file: File) {
    if (blocked || !targetValid) return;
    if (atLimit("file")) { setError(t("assistant.artifacts.limit")); return; }
    if (!file.size || file.size > 8 * 1024 * 1024) { setError(t("assistant.artifacts.fileSize")); return; }
    setBusy(true); setError(undefined);
    try {
      const form = new FormData(); form.append("projectIds", JSON.stringify([projectId])); form.append("file", file);
      const result = await apiUpload<{ artifactId: string; filename: string; expiresAt: string }>("/api/v1/rag/artifacts/files", form);
      setNow(Date.now());
      onChange([...value, { id: result.artifactId, type: "file", label: result.filename, projectId, expiresAt: result.expiresAt }]);
    } catch (cause) { failure(cause); } finally { setBusy(false); }
  }
  async function saveCredential() {
    if (blocked || !targetValid || !secret.trim() || !baseUrl.trim()) return;
    if (atLimit("credential")) { setError(t("assistant.artifacts.limit")); return; }
    setBusy(true); setError(undefined);
    try {
      const result = await apiPost<{ credentialRef: string; expiresAt: string }>("/api/v1/rag/artifacts/credentials", { token: secret, projectIds: [projectId], kind, baseUrl });
      setSecret(""); setNow(Date.now());
      onChange([...value, { id: result.credentialRef, type: "credential", label: t("assistant.artifacts.credentialName", { service: services[kind].name }), projectId, expiresAt: result.expiresAt }]);
    } catch (cause) { failure(cause); } finally { setBusy(false); }
  }
  async function remove(item: AssistantArtifactSelection) {
    if (blocked) return;
    setBusy(true); setError(undefined);
    try { await apiDelete(`/api/v1/rag/artifacts/${item.id}`); onChange(value.filter(entry => entry.id !== item.id)); }
    catch (cause) { failure(cause); } finally { setBusy(false); }
  }
  return <div className="assistant-artifacts">
    <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={panelId} disabled={disabled || !availableProjects.length || (!!scopeProject && !availableProjects.some(project => project.id === scopeProject))} onClick={() => { setOpen(!open); setSecret(""); setError(undefined); }}><Icon name="upload" size={15} />{t("assistant.artifacts.add")}</Button>
    {value.length > 0 && <ul className="assistant-artifact-list" aria-label={t("assistant.artifacts.selected")}>
      {value.map(item => <li key={item.id} className={Date.parse(item.expiresAt) <= now ? "is-expired" : undefined}>
        <Icon name={item.type === "file" ? "file" : "key"} size={16} />
        <div className="assistant-artifact-meta"><span title={item.label}>{item.label}</span><small>{projects.find(project => project.id === item.projectId)?.name ?? t("assistant.unavailable")} · {Date.parse(item.expiresAt) <= now ? t("assistant.artifacts.expired") : t("assistant.artifacts.ttl", { minutes: Math.max(1, Math.ceil((Date.parse(item.expiresAt) - now) / 60_000)) })}</small></div>
        <Button size="sm" variant="ghost" iconOnly disabled={blocked} aria-label={t("assistant.artifacts.remove", { name: item.label })} onClick={() => void remove(item)}><Icon name="x" size={15} /></Button>
      </li>)}
    </ul>}
    {open && <div id={panelId} className="assistant-artifact-panel">
      <div className="assistant-artifact-toolbar">
        <Select ariaLabel={t("assistant.artifacts.project")} placeholder={t("assistant.artifacts.chooseProject")} value={projectId} disabled={blocked || !!scopeProject} searchable
          options={availableProjects.filter(project => !scopeProject || project.id === scopeProject).map(project => ({ value: project.id, label: `${project.name} · ${project.key}` }))} onChange={setProjectId} />
        <Button size="sm" variant="ghost" aria-pressed={credential} disabled={blocked} onClick={() => { setCredential(!credential); setSecret(""); setError(undefined); }}>{credential ? t("assistant.artifacts.fileMode") : t("assistant.artifacts.configureCredential")}</Button>
      </div>
      {credential ? <form className="assistant-credential-form" onSubmit={event => { event.preventDefault(); void saveCredential(); }}>
        <Select ariaLabel={t("assistant.artifacts.provider")} value={kind} disabled={blocked} options={Object.entries(services).map(([value, service]) => ({ value, label: service.name }))}
          onChange={value => { setKind(value as Kind); setBaseUrl(services[value as Kind].url); setSecret(""); }} />
        <TextInput label={t("assistant.artifacts.baseUrl")} type="url" value={baseUrl} maxLength={500} required disabled={blocked} onChange={event => setBaseUrl(event.target.value)} />
        <TextInput label={t("assistant.artifacts.token")} type="password" value={secret} maxLength={2000} required autoComplete="off" disabled={blocked} onChange={event => setSecret(event.target.value)} />
        <Button size="sm" type="submit" loading={busy} disabled={disabled || !targetValid || !secret.trim() || !baseUrl.trim()}>{t("assistant.artifacts.saveCredential")}</Button>
      </form> : <TextInput className="assistant-artifact-file" label={t("assistant.artifacts.chooseFile")} type="file" disabled={blocked || !targetValid} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />}
      <p className="assistant-artifact-hint">{t(credential ? "assistant.artifacts.credentialHint" : "assistant.artifacts.fileHint")}</p>
      {busy && <p className="assistant-artifact-hint" role="status">{t("assistant.artifacts.saving")}</p>}
    </div>}
    {error && <p className="assistant-notice" role="alert">{error}</p>}
  </div>;
}
