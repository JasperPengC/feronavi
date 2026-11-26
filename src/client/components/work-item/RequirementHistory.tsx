import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { RequirementRevision, RequirementRevisionPage, RequirementRevisionSummary } from "../../../shared/schemas/requirement-revision.ts";
import { compareText } from "../../../shared/requirement-diff.ts";
import { apiGet } from "../../lib/api.ts";
import { queryKeys } from "../../lib/query-keys.ts";
import { t, useLocale } from "../../i18n/index.ts";
import { Select } from "../Select.tsx";
import { Button } from "../ui/Button.tsx";
import { MarkdownView } from "../ui/MarkdownView.tsx";

export function RequirementHistory(props: { workItemId: string; workItemVersion: number }) {
  useLocale();
  const [open, setOpen] = useState(false);
  return <details className="wi-detail-fold requirement-history" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{t("revision.history")}</summary>
    {open && <HistoryContent key={props.workItemId} {...props} />}
  </details>;
}

function LoadError({ error, retry }: { error: Error; retry: () => void }) {
  return <div className="requirement-history__error"><p role="alert">{error.message}</p>
    <Button size="sm" variant="ghost" onClick={retry}>{t("revision.retry")}</Button></div>;
}

function HistoryContent({ workItemId, workItemVersion }: { workItemId: string; workItemVersion: number }) {
  const [selection, setSelection] = useState("");
  const [comparison, setComparison] = useState("");
  const [compare, setCompare] = useState(false);
  const history = useInfiniteQuery({
    queryKey: queryKeys.requirementHistory(workItemId, workItemVersion), initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => apiGet<RequirementRevisionPage>(`/api/v1/work-items/${workItemId}/revisions?limit=20${pageParam ? `&before=${pageParam}` : ""}`),
    getNextPageParam: page => page.nextCursor ?? undefined, retry: false,
  });
  const entries = history.data?.pages.flatMap(page => page.items) ?? [];
  const selected = entries.find(entry => entry.id === selection) ?? entries[0];
  const previous = entries.find(entry => entry.id === comparison && entry.id !== selected?.id)
    ?? entries.find(entry => entry.revisionNo < (selected?.revisionNo ?? 0));
  const options = (rows: RequirementRevisionSummary[]) => rows.map(entry => ({ value: entry.id, label: `V${entry.revisionNo} · ${entry.title}` }));
  const read = (id: string | undefined) => apiGet<RequirementRevision>(`/api/v1/work-items/${workItemId}/revisions/${id}`);
  const current = useQuery({ queryKey: ["requirement-revision", workItemId, selected?.id], queryFn: () => read(selected?.id), enabled: !!selected && !history.isError, retry: false });
  const base = useQuery({ queryKey: ["requirement-revision", workItemId, previous?.id], queryFn: () => read(previous?.id), enabled: compare && !!previous && !history.isError, retry: false });
  if (history.isError && !history.isFetchNextPageError) return <LoadError error={history.error} retry={() => { void history.refetch(); }} />;
  if (history.isPending) return <p className="muted" role="status">{t("common.loading")}</p>;
  if (!selected) return <p className="muted">{t("revision.empty")}</p>;
  return <div className="requirement-history__content">
    <div className="requirement-history__toolbar" data-comparing={compare || undefined}>
      <Select label={t("revision.viewVersion")} ariaLabel={t("revision.viewVersion")} value={selected.id} options={options(entries)}
        onChange={value => { setSelection(value); setComparison(""); }} />
      {compare && <Select label={t("revision.compareWith")} ariaLabel={t("revision.compareWith")} value={previous?.id ?? ""}
        options={options(entries.filter(entry => entry.id !== selected.id))} placeholder={t("revision.selectBase")} onChange={setComparison} />}
      <Button size="sm" aria-pressed={compare} onClick={() => setCompare(value => !value)}>{t(compare ? "revision.viewContent" : "revision.compare")}</Button>
    </div>
    <div className="requirement-history__meta">
      <span>{selected.source === "BASELINE" ? t("revision.baseline") : selected.source === "INITIAL" ? t("revision.initial") : t("revision.edited")}</span>
      <span>{selected.authorName ?? t("revision.unknownAuthor")}</span>
      <time dateTime={selected.createdAt}>{new Date(selected.createdAt).toLocaleString()}</time>
    </div>
    {selected.source === "BASELINE" && <p className="requirement-history__note">{t("revision.baselineHint")}</p>}
    {compare && !previous && <p className="muted">{t("revision.noBase")}</p>}
    {current.isError ? <LoadError error={current.error} retry={() => { void current.refetch(); }} />
      : current.isPending ? <p role="status" className="muted">{t("common.loading")}</p>
        : current.data && (compare ? (previous && (base.isError ? <LoadError error={base.error} retry={() => { void base.refetch(); }} />
          : base.isPending ? <p role="status" className="muted">{t("common.loading")}</p>
            : base.data && <RevisionComparison before={base.data} after={current.data} />))
          : <article className="requirement-history__document"><h4>{current.data.title}</h4>
            {current.data.description ? <MarkdownView text={current.data.description} /> : <p className="muted">{t("wiDetail.noDescription")}</p>}</article>)}
    {history.isFetchNextPageError && <LoadError error={history.error!} retry={() => { void history.fetchNextPage(); }} />}
    {history.hasNextPage && !history.isFetchNextPageError && <Button variant="ghost" size="sm" loading={history.isFetchingNextPage} onClick={() => { void history.fetchNextPage(); }}>{t("revision.loadOlder")}</Button>}
  </div>;
}

function RevisionComparison({ before, after }: { before: RequirementRevision; after: RequirementRevision }) {
  const title = useMemo(() => compareText(before.title, after.title), [before.title, after.title]);
  const body = useMemo(() => compareText(before.description ?? "", after.description ?? ""), [before.description, after.description]);
  const identical = before.title === after.title && before.description === after.description;
  return <div className="requirement-history__comparison">
    <p className="requirement-history__direction">V{before.revisionNo} → V{after.revisionNo}
      <span className="requirement-history__legend"><span data-change="remove">− <span>{t("revision.removed")}</span></span><span data-change="add">+ <span>{t("revision.added")}</span></span></span></p>
    {identical ? <p className="muted">{t("revision.identical")}</p> : <>
      {title.chunks.some(chunk => chunk.kind !== "equal") && <DiffBlock label={t("revision.title")} chunks={title.chunks} />}
      {before.description !== after.description && <DiffBlock label={t("revision.body")} chunks={body.chunks} />}
      {before.description !== after.description && !body.chunks.length && <p className="muted">{t("revision.emptyChanged")}</p>}
      {(title.coarse || body.coarse) && <p className="muted">{t("revision.coarse")}</p>}
    </>}
  </div>;
}

export function DiffBlock({ label, chunks }: { label: string; chunks: ReturnType<typeof compareText>["chunks"] }) {
  return <section className="requirement-history__diff" aria-label={label}><h4>{label}</h4>
    {chunks.map((chunk, index) => <div key={index} data-change={chunk.kind}>
      <span className="requirement-history__sign" aria-hidden="true">{chunk.kind === "add" ? "+" : chunk.kind === "remove" ? "−" : " "}</span>
      {chunk.kind === "add" ? <ins>{chunk.text}</ins> : chunk.kind === "remove" ? <del>{chunk.text}</del> : <span>{chunk.text}</span>}
    </div>)}
  </section>;
}
