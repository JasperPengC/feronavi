/** 项目知识索引状态、页级切片预览、检索与引用问答。 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Chip, Loading } from "./Page.tsx";
import { Panel } from "./ui/Panel.tsx";
import { apiGet, apiPost, ApiError } from "../lib/api.ts";
import { t, useLocale } from "../i18n/index.ts";
import { Button } from "./ui/Button.tsx";
import { TextInput } from "./ui/TextInput.tsx";
import { Link } from "@tanstack/react-router";

interface Hit { pageId: string; title: string; headingPath: string | null; snippet: string; score?: number }
interface SearchResult { hits: Hit[]; mode: string; note?: string }
interface AskResult {
  ok: boolean; answer: string | null; mode: string; note?: string;
  citations: { pageId: string; title: string; headingPath: string | null; snippet: string }[];
}
interface PageChunks {
  generation: number;
  revisionId: string | null;
  chunks: { id: string; headingPath: string | null; content: string; tokenCount: number; createdAt: string; hasVector: boolean }[];
}
interface IndexJob {
  id: string; status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  total: number; processed: number; failed: number; errorMessage: string | null; createdAt: string;
}

export function KnowledgePanel({ projectId, pageId, revisionId, canReindex, onOpenPage, indexOnly = false }: {
  projectId: string;
  pageId?: string;
  revisionId?: string | null;
  canReindex?: boolean;
  onOpenPage?: (id: string) => void;
  indexOnly?: boolean;
}) {
  useLocale();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [question, setQuestion] = useState("");
  const [open, setOpen] = useState(true);
  const [chunksOpen, setChunksOpen] = useState(false);

  const aiStatus = useQuery({
    queryKey: ["ai-status"],
    queryFn: () => apiGet<{ configured: boolean; model?: string; message?: string }>("/api/v1/knowledge/ai-status"),
    staleTime: 60_000,
  });
  const chunks = useQuery({
    queryKey: ["knowledge-chunks", pageId, revisionId],
    queryFn: () => apiGet<PageChunks>(`/api/v1/pages/${pageId}/chunks`),
    enabled: !!pageId,
  });
  const jobs = useQuery({
    queryKey: ["knowledge-jobs", pageId],
    queryFn: () => apiGet<{ jobs: IndexJob[] }>(`/api/v1/pages/${pageId}/index-jobs`),
    enabled: !!pageId,
  });
  const search = useMutation({
    mutationFn: (text: string) => apiGet<SearchResult>(`/api/v1/projects/${projectId}/knowledge/search?q=${encodeURIComponent(text)}`),
  });
  const ask = useMutation({
    mutationFn: (text: string) => apiPost<AskResult>("/api/v1/knowledge/ask", { projectId, question: text }),
  });
  const reindex = useMutation({
    mutationFn: () => apiPost("/api/v1/pages/" + pageId + "/reindex", {}),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["knowledge-chunks", pageId] }),
        qc.invalidateQueries({ queryKey: ["knowledge-jobs", pageId] }),
      ]);
    },
  });

  const hits = search.data?.hits ?? [];
  const asked = ask.data;
  const pageChunks = chunks.data?.chunks ?? [];
  const pageJobs = jobs.data?.jobs ?? [];
  const latestJob = pageJobs[0];
  const vectorCount = pageChunks.filter((chunk) => chunk.hasVector).length;

  const openSource = (id: string) => onOpenPage?.(id);
  const submitSearch = () => { if (q.trim() && !search.isPending) search.mutate(q.trim()); };
  const submitAsk = () => { if (question.trim() && !ask.isPending) ask.mutate(question.trim()); };
  const statusLabel = (status: IndexJob["status"]) => ({
    PENDING: t("kn.statusPending"), RUNNING: t("kn.statusRunning"),
    SUCCEEDED: t("kn.statusSucceeded"), FAILED: t("kn.statusFailed"), CANCELLED: t("kn.statusCancelled"),
  })[status];
  const errorMessage = (error: unknown, fallbackKey: string) => error instanceof ApiError ? error.message : t(fallbackKey);

  return (
    <Panel
      title={t(indexOnly ? "kn.indexTitle" : "kn.workspaceTitle")}
      className="knowledge-panel"
      actions={indexOnly ? undefined : <Chip active={open} onClick={() => setOpen((v) => !v)}>{open ? t("kn.collapse") : t("kn.expand")}</Chip>}
      style={{ marginBottom: 16, flex: "none" }}
    >
      <p className="knowledge-intro">{t(indexOnly ? "assistant.indexIntro" : "kn.workspaceDescription")}</p>
      {indexOnly && <p className="knowledge-assistant-link"><Link to="/assistant" search={{ project: projectId }}>{t("assistant.openProject")}</Link></p>}
      {pageId && (
        <section className="knowledge-index" aria-labelledby="knowledge-index-title">
          <div className="knowledge-index-head">
            <div>
              <h3 id="knowledge-index-title">{t("kn.indexTitle")}</h3>
              <p className="muted">
                {aiStatus.data?.configured
                  ? `${t("kn.semantic")} · ${aiStatus.data.model ?? ""}`
                  : t("kn.degraded")}
              </p>
            </div>
            {canReindex && (
              <Button size="sm" variant="primary" disabled={reindex.isPending}
                onClick={() => reindex.mutate()}>
                {reindex.isPending ? t("kn.reindexing") : t("kn.reindex")}
              </Button>
            )}
          </div>

          {chunks.isLoading || jobs.isLoading
            ? <p className="muted" role="status">{t("common.loading")}</p>
            : chunks.isError || jobs.isError
              ? <div className="knowledge-error" role="alert">
                  <span>{errorMessage(chunks.error ?? jobs.error, "kn.indexUnknown")}</span>
                  <Button size="sm" onClick={() => { void chunks.refetch(); void jobs.refetch(); }}>{t("kn.retry")}</Button>
                </div>
              : <>
                  <div className="knowledge-index-summary" role="status" aria-live="polite">
                    <span className={`status-pill ${latestJob?.status === "FAILED" ? "dot-red" : pageChunks.length ? "dot-green" : "dot-amber"}`}>
                      {latestJob?.status === "RUNNING"
                        ? statusLabel("RUNNING")
                        : latestJob?.status === "FAILED"
                          ? statusLabel("FAILED")
                          : pageChunks.length ? t("kn.indexed") : t("kn.notIndexed")}
                    </span>
                    <span className="muted">{t("kn.chunkCount", { count: pageChunks.length })}</span>
                    {pageChunks.length > 0 && <span className="muted">{t("kn.vectorCount", { count: vectorCount })}</span>}
                    {latestJob?.status === "RUNNING" && (
                      <span className="muted">{latestJob.processed} / {latestJob.total}</span>
                    )}
                  </div>
                  {latestJob?.status === "FAILED" && latestJob.errorMessage && (
                    <p className="knowledge-job-error" role="status">{latestJob.errorMessage}</p>
                  )}
                  {reindex.isError && <p className="knowledge-job-error" role="alert">{errorMessage(reindex.error, "kn.reindexFailed")}</p>}
                  {reindex.isSuccess && <p className="knowledge-success" role="status">{t("kn.indexed")}</p>}

                  <div className="knowledge-chunks">
                    <button type="button" className="knowledge-disclosure" aria-expanded={chunksOpen}
                      onClick={() => setChunksOpen((value) => !value)}>
                      <span>{t("kn.chunkPreview")}</span>
                      <span className="muted">{pageChunks.length}</span>
                      <span aria-hidden="true">{chunksOpen ? "−" : "+"}</span>
                    </button>
                    {chunksOpen && (pageChunks.length > 0
                      ? <ol className="knowledge-chunk-list">
                          {pageChunks.map((chunk, i) => (
                            <li key={chunk.id} className="knowledge-chunk">
                              <div className="knowledge-chunk-heading">
                                <strong>{chunk.headingPath || `#${i + 1}`}</strong>
                                <span className={`tag ${chunk.hasVector ? "tag-success" : ""}`}>
                                  {chunk.hasVector ? t("kn.hasVector") : t("kn.vectorPending")}
                                </span>
                              </div>
                              <p>{chunk.content}</p>
                            </li>
                          ))}
                        </ol>
                      : <p className="muted knowledge-empty">{t("kn.noChunks")}</p>)}
                  </div>
                  {pageJobs.length > 0 && (
                    <details className="knowledge-job-list">
                      <summary>{t("kn.jobs")}</summary>
                      <ul>
                        {pageJobs.slice(0, 5).map((job) => (
                          <li key={job.id}>
                            <span className={`status-pill ${job.status === "SUCCEEDED" ? "dot-green" : job.status === "FAILED" ? "dot-red" : "dot-amber"}`}>
                              {statusLabel(job.status)}
                            </span>
                            <span>{job.processed} / {job.total}</span>
                            <time dateTime={job.createdAt}>{new Date(job.createdAt).toLocaleString()}</time>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>}
        </section>
      )}

      {!indexOnly && open && (
        <>
          {!pageId && <p className="muted knowledge-ai-note">
            {aiStatus.data?.configured
              ? `${t("kn.semantic")} · ${aiStatus.data.model ?? ""}`
              : t("kn.degraded")}
          </p>}
          <div className="toolbar knowledge-toolbar">
            <TextInput label={t("kn.searchLabel")} placeholder={t("kn.searchPlaceholder")} aria-label={t("kn.searchLabel")}
              value={q} onChange={(event) => setQ(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") submitSearch(); }} />
            <Button disabled={!q.trim() || search.isPending} onClick={submitSearch}>
              {search.isPending ? t("kn.searching") : t("kn.searchBtn")}
            </Button>
          </div>
          {search.isError && <p className="knowledge-error" role="alert">{errorMessage(search.error, "kn.searchFailed")}</p>}
          {search.isPending && <Loading rows={2} />}
          {search.isSuccess && (
            <div className="knowledge-results">
              <p className="muted knowledge-result-meta">
                {hits.length} · {search.data.mode === "vector" ? t("kn.semantic") : t("kn.keyword")}
                {search.data.note && ` · ${search.data.note}`}
              </p>
              <ul className="hit-list">
                {hits.map((hit, i) => (
                  <li key={`${hit.pageId}-${i}`}>
                    <div className="hit-head">
                      <button type="button" className="hit-title" disabled={!onOpenPage} onClick={() => openSource(hit.pageId)}>{hit.title}</button>
                      {hit.headingPath && <span className="tag">{hit.headingPath}</span>}
                    </div>
                    <p className="hit-snippet">{hit.snippet}</p>
                  </li>
                ))}
                {hits.length === 0 && <li className="muted">{t("kn.noMatch")}</li>}
              </ul>
            </div>
          )}

          <div className="toolbar knowledge-toolbar knowledge-ask-toolbar">
            <TextInput label={t("kn.askLabel")} placeholder={t("kn.askPlaceholder")} aria-label={t("kn.askLabel")}
              value={question} onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") submitAsk(); }} />
            <Button variant="primary" disabled={!question.trim() || ask.isPending} onClick={submitAsk}>
              {ask.isPending ? t("kn.thinking") : t("kn.askBtn")}
            </Button>
          </div>
          {ask.isPending && <Loading rows={2} />}
          {ask.isError && <p className="knowledge-error" role="alert">{errorMessage(ask.error, "kn.askFailed")}</p>}
          {asked && (
            <div className="ask-result" role="status">
              {asked.answer
                ? <p className="knowledge-answer">{asked.answer}</p>
                : <p className="muted knowledge-result-note">{asked.note ?? t("kn.noAnswer")}</p>}
              {asked.citations.length > 0 && (
                <>
                  <p className="muted knowledge-citations-label">{t("kn.citations")}</p>
                  <ol className="citation-list">
                    {asked.citations.map((citation, i) => (
                      <li key={`${citation.pageId}-${i}`}>
                        <button type="button" className="hit-title" disabled={!onOpenPage} onClick={() => openSource(citation.pageId)}>{citation.title}</button>
                        {citation.headingPath && <span className="tag">{citation.headingPath}</span>}
                        <div className="hit-snippet">{citation.snippet}</div>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
