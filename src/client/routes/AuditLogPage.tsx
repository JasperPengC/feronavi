import { TableScroll } from "../components/ui/TableScroll.tsx";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, ApiError } from "../lib/api.ts";
import { EmptyState, PageHead } from "../components/Page.tsx";
import { Button } from "../components/ui/Button.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { Select } from "../components/Select.tsx";
import { Icon } from "../components/Icon.tsx";
import { PagePagination } from "../components/ui/PagePagination.tsx";
import { LoadingBlock, StateBlock } from "../components/ui/StateBlock.tsx";
import { toast } from "../components/ui/Toast.tsx";
import { Drawer } from "../components/ui/Drawer.tsx";
import { t as tr, useLocale, currentLocale } from "../i18n/index.ts";
import { relativeTime } from "../lib/time.ts";
import { auditActionLabel, auditTargetLabel } from "../lib/audit-presentation.ts";

interface AuditItem {
  id: string;
  actorId: string | null;
  actorSnapshot: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  changes: unknown;
  ip: string | null;
  /** ip2region 归属地（服务端富化；库不可用/非 IPv4 时为 null） */
  ipLocation?: string | null;
  userAgent: string | null;
  severity: "SECURITY" | "BUSINESS";
  createdAt: string;
}

const PAGE_SIZE = 30;
const TARGET_TYPES = [
  "MEMBER", "ROLE", "ROLE_ASSIGNMENT", "API_TOKEN", "SETTING", "PROJECT", "WORK_ITEM",
  "MILESTONE", "ITERATION", "RELEASE", "MODULE", "PAGE", "ANNOUNCEMENT", "IDEA", "ATTACHMENT", "IMPORT_BATCH",
];

export function AuditLogPage() {
  useLocale();
  const [page, setPage] = useState(1);
  const [severity, setSeverity] = useState<"" | "SECURITY" | "BUSINESS">("");
  const [targetType, setTargetType] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [keyword, setKeyword] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selected, setSelected] = useState<AuditItem | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setKeyword(qDraft.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [qDraft]);
  useEffect(() => { setPage(1); }, [severity, targetType, keyword, fromDate, toDate]);

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (severity) params.set("severity", severity);
  if (targetType) params.set("targetType", targetType);
  if (keyword) params.set("q", keyword);
  if (fromDate) params.set("from", fromDate);
  if (toDate) params.set("to", `${toDate}T23:59:59.999Z`);

  const q = useQuery({
    queryKey: ["audit-entries", severity, targetType, keyword, fromDate, toDate, page],
    queryFn: () => apiGet<{ items: AuditItem[]; total: number; page: number; pageSize: number }>(
      `/api/v1/audit-entries?${params.toString()}`),
    retry: false,
  });

  const items = q.data?.items ?? [];
  const [exporting, setExporting] = useState(false);

  /** 导出当前筛选结果（CSV，走 cookie 鉴权；Blob 下载，不新开页面） */
  async function exportCsv() {
    const filters = new URLSearchParams();
    if (severity) filters.set("severity", severity);
    if (targetType) filters.set("targetType", targetType);
    if (keyword) filters.set("q", keyword);
    if (fromDate) filters.set("from", fromDate);
    if (toDate) filters.set("to", `${toDate}T23:59:59.999Z`);
    setExporting(true);
    try {
      const res = await fetch(`/api/v1/audit-entries/export?${filters.toString()}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(tr("audit.loadFailed"));
    } finally {
      setExporting(false);
    }
  }
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const restricted = q.error instanceof ApiError && q.error.status === 403;

  return (
    <div className="page audit-page data-page">
      <PageHead
        title={tr("audit.title")}
        actions={<Button size="sm" loading={exporting} disabled={restricted || exporting || items.length === 0} onClick={() => void exportCsv()}>
          <Icon name="download" size={14} />{tr("audit.exportCsv")}
        </Button>}
      />

      {restricted ? (
        <div className="alert alert-error">{tr("audit.restricted")}</div>
      ) : (
        <div className="audit-list-panel data-fill">
          <div className="toolbar audit-toolbar">
            <div className="audit-filter-main">
              <div className="audit-categories ui-segmented" role="group" aria-label={tr("audit.colSeverity")}>
                <button type="button" className="ui-segmented-item" aria-pressed={severity === ""} onClick={() => setSeverity("")}>{tr("audit.severityAll")}</button>
                <button type="button" className="ui-segmented-item" aria-pressed={severity === "SECURITY"} onClick={() => setSeverity("SECURITY")}>{tr("audit.severitySecurity")}</button>
                <button type="button" className="ui-segmented-item" aria-pressed={severity === "BUSINESS"} onClick={() => setSeverity("BUSINESS")}>{tr("audit.severityBusiness")}</button>
              </div>
              <TextInput inputClassName="audit-search" placeholder={tr("audit.searchPlaceholder")}
                aria-label={tr("audit.searchPlaceholder")} value={qDraft} onChange={(e) => setQDraft(e.target.value)} />
            </div>
            <div className="audit-filter-details">
              <Select size="sm" ariaLabel={tr("audit.colTarget")} value={targetType} onChange={setTargetType}
                options={[{ value: "", label: tr("audit.targetAll") }, ...TARGET_TYPES.map((x) => ({ value: x, label: auditTargetLabel(x) }))]} />
              <div className="audit-date-range">
                <label className="date-filter"><span className="sr-only">{tr("audit.from")}</span><TextInput inputClassName="audit-date" type="date"
                  value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
                <span className="muted" aria-hidden="true">–</span>
                <label className="date-filter"><span className="sr-only">{tr("audit.to")}</span><TextInput inputClassName="audit-date" type="date"
                  value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
              </div>
              {(fromDate || toDate) && <Button size="sm" variant="ghost" onClick={() => { setFromDate(""); setToDate(""); }}>{tr("audit.clearDates")}</Button>}
            </div>
          </div>

          {q.isLoading && <LoadingBlock />}
          {q.isError && !restricted && <StateBlock kind="error" title={tr("audit.loadFailed")}
            action={() => void q.refetch()} actionLabel={tr("common.reload")} />}
          {!q.isLoading && !q.isError && items.length === 0 && (
            <EmptyState title={tr("audit.empty")} hint={tr("audit.emptyHint")} />
          )}

          {items.length > 0 && (
            <TableScroll className="audit-table-wrap" label={tr("audit.title")} resetKey={JSON.stringify([page, severity, targetType, keyword, fromDate, toDate])}>
              <table className="table audit-table">
                <thead><tr>
                  <th>{tr("audit.colAction")}</th>
                  <th>{tr("audit.colActor")}</th>
                  <th>{tr("audit.colTarget")}</th>
                  <th>{tr("audit.colTime")}</th>
                  <th className="table-actions">{tr("audit.detail")}</th>
                </tr></thead>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id}>
                      <td className="audit-operation" data-label={tr("audit.colAction")}>
                        <span className="table-primary" title={a.action}>{auditActionLabel(a.action)}</span>
                        <span className="table-secondary audit-category"><Icon name={a.severity === "SECURITY" ? "shield" : "layers"} size={12} />
                          {a.severity === "SECURITY" ? tr("audit.severitySecurity") : tr("audit.severityBusiness")}
                        </span>
                      </td>
                      <td data-label={tr("audit.colActor")}>
                        <span>{a.actorSnapshot ?? (a.actorId ? a.actorId.slice(0, 8) : tr("audit.systemActor"))}</span>
                        {a.ip && <span className="table-secondary">{a.ip}{a.ipLocation ? ` · ${a.ipLocation}` : ""}</span>}
                      </td>
                      <td data-label={tr("audit.colTarget")}>
                        <span>{auditTargetLabel(a.targetType)}</span>
                        {a.targetId && <span className="table-secondary mono" title={a.targetId}>{a.targetId.slice(0, 8)}</span>}
                      </td>
                      <td data-label={tr("audit.colTime")} title={new Date(a.createdAt).toLocaleString(currentLocale())}>
                        <time dateTime={a.createdAt}>{new Date(a.createdAt).toLocaleString(currentLocale(), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</time>
                        <span className="table-secondary">{relativeTime(a.createdAt)}</span>
                      </td>
                      <td className="table-actions" data-label={tr("audit.detail")}>
                        <Button size="sm" variant="ghost" onClick={() => setSelected(a)}>{tr("audit.detail")}<Icon name="chevron-right" size={13} /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}

          <PagePagination page={page} pages={pages} total={total} onPage={setPage} showSingle />
        </div>
      )}

      <Drawer open={!!selected} title={tr("audit.detailTitle")} onClose={() => setSelected(null)} width="md">
        {selected && (
          <div className="audit-detail">
            <p className="audit-detail-row"><span className="muted">{tr("audit.colTime")}</span>
              <span>{new Date(selected.createdAt).toLocaleString(currentLocale())}</span></p>
            <p className="audit-detail-row"><span className="muted">{tr("audit.colSeverity")}</span>
              <span className="tag">
                {selected.severity === "SECURITY" ? tr("audit.severitySecurity") : tr("audit.severityBusiness")}
              </span></p>
            <p className="audit-detail-row"><span className="muted">{tr("audit.colAction")}</span><code className="mono">{selected.action}</code></p>
            <p className="audit-detail-row"><span className="muted">{tr("audit.colActor")}</span>
              <span>{selected.actorSnapshot ?? tr("audit.systemActor")}</span></p>
            <p className="audit-detail-row"><span className="muted">{tr("audit.actorId")}</span><code className="mono">{selected.actorId ?? "—"}</code></p>
            <p className="audit-detail-row"><span className="muted">{tr("audit.colTarget")}</span>
              <code className="mono">{selected.targetType}{selected.targetId ? ` · ${selected.targetId}` : ""}</code></p>
            <p className="audit-detail-row"><span className="muted">IP</span><code className="mono">{selected.ip ?? "—"}</code>{selected.ipLocation && <span className="tag">{selected.ipLocation}</span>}</p>
            <p className="audit-detail-row"><span className="muted">{tr("audit.userAgent")}</span><span className="mono" style={{ wordBreak: "break-all" }}>{selected.userAgent ?? "—"}</span></p>
            <h3 className="audit-detail-title">{tr("audit.changesFull")}</h3>
            <pre className="audit-detail-json">{selected.changes ? JSON.stringify(selected.changes, null, 2) : "—"}</pre>
          </div>
        )}
      </Drawer>
    </div>
  );
}
