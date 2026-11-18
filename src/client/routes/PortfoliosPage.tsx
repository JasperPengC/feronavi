import { TableScroll } from "../components/ui/TableScroll.tsx";
/** 项目集（前端长目标）：跨项目组合视图 —— 后端早已就绪，此前前端零接线 */
import { queryKeys } from "../lib/query-keys.ts";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHead, PageGrid, Loading, ErrorState, Chip } from "../components/Page.tsx";
import { Panel } from "../components/ui/Panel.tsx";
import { MetricCard } from "../components/ui/MetricCard.tsx";
import { toast } from "../components/ui/Toast.tsx";
import { Button } from "../components/ui/Button.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { apiDelete, apiGet, apiPost, ApiError } from "../lib/api.ts";
import { useCan } from "../lib/actor.ts";
import { t, useLocale } from "../i18n/index.ts";
import { Icon } from "../components/Icon.tsx";
import { StateBlock } from "../components/ui/StateBlock.tsx";

interface Portfolio { id: string; name: string; projectCount: number; workItemCount: number; createdAt: string }
interface ProjectItem { id: string; key: string; name: string; workItemCount: number }

export function PortfoliosPage() {
  useLocale();   // 订阅语言，切换即时生效
  const qc = useQueryClient();
  // ⚠️ 门控必须与服务端一致：createPortfolio 要求的是 project:create（portfolio.service.ts）。
  // 此前写的 "portfolio:manage" 在权限目录里根本不存在 → 所有人永远看不到创建入口（走查 P3-8）。
  const canManage = useCan("project:create");
  const [name, setName] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  // undefined 表示初次默认选中；null 表示用户主动收起。
  const [activeId, setActiveId] = useState<string | null | undefined>(undefined);

  const list = useQuery({ queryKey: ["portfolios"], queryFn: () => apiGet<{ portfolios: Portfolio[] }>("/api/v1/portfolios") });
  const projects = useQuery({ queryKey: queryKeys.projects("pick"), queryFn: () => apiGet<{ items: ProjectItem[] }>("/api/v1/projects") });
  // 密度 + UX：侧列此前只在 activeId 与 detail.data 同时存在时才渲染 → 页面加载后右半边是空的。
  // 做法：**在渲染层给 activeId 兜底默认值**（不用 useEffect、不额外触发请求、不会造成渲染循环）——
  // 上一轮我用 useEffect 版本把页面改到运行时不渲染（tsc/构建/单测全绿也没拦住，是浏览器密度探针拦下的）。
  const effectiveId = activeId === undefined ? list.data?.portfolios?.[0]?.id ?? null : activeId;
  const detail = useQuery({
    queryKey: ["portfolio", effectiveId],
    // ⚠️ 接口返回的是**扁平结构**（实测 curl：{id,name,projects,projectCount,workItemCount}），
    // 此前这里写成 { portfolio, projects } → 渲染时读 detail.data.portfolio.name 会抛错、
    // **详情面板一旦渲染就崩**（所以它一直"没被用过"，直到本轮默认选中才暴露）。
    queryFn: () => apiGet<Portfolio & { projects: ProjectItem[] }>(`/api/v1/portfolios/${effectiveId}`),
    enabled: !!effectiveId,
  });

  const create = useMutation({
    mutationFn: () => apiPost("/api/v1/portfolios", { name }),
    onSuccess: async () => { setName(""); await qc.invalidateQueries({ queryKey: ["portfolios"] }); },
    // 操作失败 → toast（页面级 alert 会把列表顶下去，且不自动消失）
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("pf.createFailed")),
  });
  const addOne = useMutation({
    mutationFn: ({ portfolioId, projectId }: { portfolioId: string; projectId: string }) =>
      apiPost(`/api/v1/portfolios/${portfolioId}/projects`, { projectId }),
    onSuccess: async (_, { portfolioId }) => {
      await qc.invalidateQueries({ queryKey: ["portfolio", portfolioId] });
      await qc.invalidateQueries({ queryKey: ["portfolios"] });
      await qc.invalidateQueries({ queryKey: ["portfolio-summary", portfolioId] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("pf.addFailed")),
  });
  const dropOne = useMutation({
    mutationFn: ({ portfolioId, projectId }: { portfolioId: string; projectId: string }) =>
      apiDelete(`/api/v1/portfolios/${portfolioId}/projects/${projectId}`),
    onSuccess: async (_, { portfolioId }) => {
      await qc.invalidateQueries({ queryKey: ["portfolio", portfolioId] });
      await qc.invalidateQueries({ queryKey: ["portfolios"] });
      await qc.invalidateQueries({ queryKey: ["portfolio-summary", portfolioId] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("pf.removeFailed")),
  });

  const items = list.data?.portfolios ?? [];
  const totalProjects = items.reduce((n, p) => n + p.projectCount, 0);
  const totalItems = items.reduce((n, p) => n + p.workItemCount, 0);
  const candidates = (projects.data?.items ?? []).filter((p) => !detail.data?.projects.some((linked) => linked.id === p.id));
  const matchingProjects = candidates.filter((p) => `${p.key} ${p.name}`.toLowerCase().includes(projectSearch.trim().toLowerCase()));

  return (
    <div className="page collection-page portfolios-page data-page">
      <PageHead
        title={t("pf.title")}
        actions={canManage && items.length > 0 && (
          <div className="portfolio-create-inline">
            <TextInput placeholder={t("pf.namePlaceholder")} aria-label={t("pf.namePlaceholder")} value={name}
              onChange={(e) => setName(e.target.value)} />
            <Button variant="primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? t("pf.creating") : t("pf.create")}
            </Button>
          </div>
        )}
      />

      {items.length > 0 && (
        <div className="metric-grid metric-grid-3" style={{ marginBottom: 16 }}>
          <MetricCard label={t("pf.mCount")} value={items.length} tone="primary" />
          <MetricCard label={t("pf.mProjects")} value={totalProjects} />
          <MetricCard label={t("pf.mItems")} value={totalItems} />
        </div>
      )}

      <PageGrid
        main={list.isLoading ? <Loading /> : list.isError ? <ErrorState message={t("pf.loadFailed")} action={<Button onClick={() => void list.refetch()}>{t("common.reload")}</Button>} /> : items.length === 0
          ? (
            <Panel className="portfolio-empty-panel">
              <div className="portfolio-empty">
                <div className="portfolio-empty-copy">
                  <h2>{t("pf.empty")}</h2>
                  <p>{t("pf.emptyHint")}</p>
                </div>
                {canManage && (
                  <div className="portfolio-create">
                    <TextInput placeholder={t("pf.namePlaceholder")} aria-label={t("pf.namePlaceholder")} value={name}
                      onChange={(e) => setName(e.target.value)} inputClassName="portfolio-name-input" />
                    <Button variant="primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
                      {create.isPending ? t("pf.creating") : t("pf.create")}
                    </Button>
                    <p>{t("pf.createHint")}</p>
                  </div>
                )}
              </div>
            </Panel>
          )
          : (
            <Panel padding="none" className="data-fill">
              <TableScroll label={t("pf.title")}>
        <table className="table portfolio-table">
                <thead><tr><th>{t("pf.colName")}</th><th className="table-number">{t("pf.colProjects")}</th><th className="table-number">{t("pf.colItems")}</th><th className="table-actions">{t("common.actions")}</th></tr></thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id} onClick={() => setActiveId(p.id)} data-active={effectiveId === p.id ? "true" : "false"}>
                      {/* 与项目/工作项/令牌/公告同一套行样式（外壳重做第 25 轮） */}
                      <td data-label={t("pf.colName")}>
                        <div className="row-title">
                          <span className="row-avatar" aria-hidden="true"><Icon name="package" size={13} /></span>
                          <Link className="row-name" to="/portfolios/$id" params={{ id: p.id }}>{p.name}</Link>
                        </div>
                      </td>
                      <td className="table-number" data-label={t("pf.colProjects")}>{p.projectCount}</td>
                      <td className="table-number" data-label={t("pf.colItems")}>{p.workItemCount}</td>
                      <td className="table-actions">
                        <Chip active={effectiveId === p.id} onClick={() => setActiveId(p.id)}>{t("pf.view")}</Chip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
        </TableScroll>
            </Panel>
          )}
        side={effectiveId && detail.isLoading ? <Loading /> : effectiveId && detail.isError
          ? <StateBlock kind="error" title={t("pf.loadFailed")} action={() => void detail.refetch()} actionLabel={t("common.reload")} /> : effectiveId && detail.data ? (
          <Panel title={detail.data.name} actions={<Chip onClick={() => setActiveId(null)}>{t("pf.collapse")}</Chip>}>
            <p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: 0 }}>
              {t("pf.contains", { n: detail.data.projects.length })}
            </p>
            <ul className="side-list">
              {detail.data.projects.map((p) => (
                <li key={p.id}>
                  <span className="side-dot" />
                  <Link className="side-text row-link" to="/projects/$projectId/board" params={{ projectId: p.id }}>{p.name}</Link>
                  <span className="tag">{p.workItemCount}</span>
                  {canManage && (
                    <button type="button" className="chip" title={t("pf.removeTitle")}
                      disabled={addOne.isPending || dropOne.isPending}
                      onClick={() => dropOne.mutate({ portfolioId: effectiveId, projectId: p.id })}>
                      {t("pf.remove")}
                    </button>
                  )}
                </li>
              ))}
              {detail.data.projects.length === 0 && <li className="muted" style={{ fontSize: "var(--text-sm)" }}>{t("pf.emptyProjects")}</li>}
            </ul>
            {canManage && (
              <div style={{ marginTop: 12 }}>
                <p className="muted" style={{ fontSize: "var(--text-xs)" }}>{t("pf.addLabel")}</p>
                <TextInput value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} aria-label={t("pf.searchProjects")} placeholder={t("pf.searchProjects")} />
                {projects.isLoading && <Loading />}
                {projects.isError && <StateBlock kind="error" title={t("common.loadFailedShort")} action={() => void projects.refetch()} actionLabel={t("common.reload")} />}
                {projects.isSuccess && matchingProjects.length === 0 && <p className="muted">{candidates.length ? t("common.noMatches") : t("pf.allProjectsAdded")}</p>}
                <div className="toolbar portfolio-project-picker" data-custom-scroll>
                  {matchingProjects.map((p) => (
                      <button type="button" className="chip" key={p.id}
                        disabled={addOne.isPending || dropOne.isPending}
                        onClick={() => addOne.mutate({ portfolioId: effectiveId, projectId: p.id })}
                        title={t("pf.addTitle", { name: p.name })}>+ {p.key}</button>
                    ))}
                </div>
              </div>
            )}
          </Panel>
        ) : undefined}
      />
    </div>
  );
}
