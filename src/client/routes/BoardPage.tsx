/**
 * 看板（切片核心）
 *
 * 拖拽的失败处理是这一页的重点（Spec 第 5.5 节）：
 *   - 成功：用**服务端返回值覆盖**本地状态（含新 version）
 *   - VERSION_CONFLICT：回滚 + 提示「已被他人修改」并**重新拉取**
 *   - 需必填字段：弹窗补齐后重试
 *   - 其它错误：回滚 + 展示后端 message
 *
 * ⚠️ 前端**不做权限判定**，只根据 `allowedTransitions` 禁用目标列 —— 服务端仍是唯一判据。
 */
import { invalidateWorkItemQueries, queryKeys } from "../lib/query-keys.ts";
import { t, useLocale } from "../i18n/index.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "../components/ui/Toast.tsx";
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, pointerWithin, closestCenter, useSensor, useSensors, useDraggable, useDroppable } from "@dnd-kit/core";
import { apiGet, apiPost, ApiError } from "../lib/api.ts";
import { WorkItemViewHeader } from "../components/project/WorkItemViewHeader.tsx";
import { Drawer } from "../components/ui/Drawer.tsx";
import { WorkItemDrawer } from "../components/work-item/DeferredWorkItemDrawer.tsx";
import { WorkItemEditor } from "../components/work-item/WorkItemEditor.tsx";
import { Button } from "../components/ui/Button.tsx";
import { TextArea } from "../components/ui/TextArea.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { Select } from "../components/Select.tsx";
import { StateBlock } from "../components/ui/StateBlock.tsx";
import { Icon } from "../components/Icon.tsx";

interface BoardItem {
  id: string; key: string; number: number; title: string;
  priority: string | null; assigneeId: string | null; version: number;
}
interface BoardColumn {
  stateKey: string; name: string; category: string; color: string;
  wipLimit?: number | null;
  items: BoardItem[]; count: number; truncated: boolean;
}

const PRIORITY_LABEL: Record<string, string> = {
  LOWEST: "board.priority.LOWEST", LOW: "board.priority.LOW", MEDIUM: "board.priority.MEDIUM",
  HIGH: "board.priority.HIGH", URGENT: "board.priority.URGENT",
};

function dotClass(color: string): string {
  switch (color) {
    case "info": return "dot-info";
    case "warning": return "dot-warning";
    case "success": return "dot-success";
    case "danger": return "dot-danger";
    default: return "dot-neutral";
  }
}

function Card({ item, onOpen }: { item: BoardItem; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id });
  return (
    <div
      ref={setNodeRef}
      className="card board-card"
      style={{
        padding: 10, marginBottom: 8, touchAction: "none",
        // 拖动期间只改变位移与透明度，不重新计算卡片布局。
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 10 : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div className="mono muted" style={{ fontSize: "var(--text-xs)", flex: 1 }}>{item.key}</div>
        {/* 拖拽手柄独立于标题按钮，不构成嵌套交互（读屏/axe 安全） */}
        <button type="button" className="board-drag-handle" aria-label={t("board.dragCard", { key: item.key })}
          {...listeners} {...attributes}><Icon name="menu" size={12} /></button>
      </div>
      {/* 标题即入口：标准看板交互（Trello/Jira/Linear 同款），不再需要独立「详情」按钮 */}
      <button type="button" className="board-card-title"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onOpen(item.id); }}>
        {item.title}
      </button>
      {item.priority && (
        <div className="muted" style={{ fontSize: "var(--text-xs)" }}>
          {t("common.priority")} {PRIORITY_LABEL[item.priority] ? t(PRIORITY_LABEL[item.priority]!) : item.priority}
        </div>
      )}
    </div>
  );
}

function Column({ col, activeId, onOpen, dropId, showTotal = true, onLoadMore, loadingMore }: { col: BoardColumn; activeId: string | null; onOpen: (id: string) => void; dropId?: string; showTotal?: boolean; onLoadMore?: () => void; loadingMore?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId ?? col.stateKey });
  const dragging = activeId ? col.items.find((i) => i.id === activeId) : null;
  return (
    <div
      ref={setNodeRef}
      className="board-column"
      data-state-key={col.stateKey}
      data-state-category={col.category}
      style={{
        width: 220, flex: "none", display: "flex", flexDirection: "column",
        background: isOver ? "var(--surface-raised)" : "var(--surface-panel)",
        border: "1px solid var(--border)", borderTop: "3px solid var(--border-strong, var(--surface-3))",
        borderRadius: "var(--radius)", boxShadow: "none", maxHeight: "100%", overflow: "hidden",
      }}
    >
      <div style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid var(--border)" }}>
        <span className={`dot ${dotClass(col.color)}`} />
        <strong style={{ fontSize: "var(--text-sm)", flex: 1 }}>{col.name}</strong>
        <span className={`muted${col.wipLimit && col.count > col.wipLimit ? " wip-over" : ""}`} style={{ fontSize: "var(--text-xs)" }} title={col.wipLimit ? t("board.wipLimit", { n: String(col.wipLimit) }) : undefined}>
          {showTotal ? col.count : col.items.length}{col.wipLimit ? ` / ${col.wipLimit}` : ""}
        </span>
      </div>
      <div className={`board-column-body${col.items.length === 0 ? " is-empty" : ""}`} data-custom-scroll style={{ padding: 8, overflowY: "auto", flex: 1 }}>
        {col.items.map((i) => <Card key={i.id} item={i} onOpen={onOpen} />)}
        {col.items.length === 0 && !dragging && (
          <p className="muted board-empty-state" style={{ fontSize: "var(--text-xs)", textAlign: "center", padding: "12px 0" }}>{t("board.emptyColumn")}</p>
        )}
        {onLoadMore && col.items.length < col.count && (
          <Button size="sm" variant="ghost" loading={loadingMore} style={{ width: "100%", marginTop: 4 }}
            onClick={onLoadMore}>{t("board.loadMore", { n: String(col.count - col.items.length) })}</Button>
        )}
      </div>
    </div>
  );
}

export function BoardPage() {
  useLocale();   // 订阅语言，否则切换语言不重渲染
  const { projectId } = useParams({ from: "/_app/projects/$projectId/board" });
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [needFields, setNeedFields] = useState<{ itemId: string; version: number; toStateKey: string; fields: string[] } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [keyword, setKeyword] = useState("");
  const [prioFilter, setPrioFilter] = useState("");
  const [laneBy, setLaneBy] = useState<"none" | "priority">("none");
  const [extraByColumn, setExtraByColumn] = useState<Record<string, BoardItem[]>>({});
  const [loadingColumn, setLoadingColumn] = useState<string | null>(null);
  const pageRequests = useRef<Record<string, symbol>>({});
  const boardScope = `${projectId}\u0000${keyword}\u0000${prioFilter}`;
  const boardScopeRef = useRef(boardScope);
  boardScopeRef.current = boardScope;
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const boardScrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setKeyword(q.trim()), 250); return () => window.clearTimeout(timer); }, [q]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // 键盘可达性是硬要求（WCAG 2.1 AA），必须保留
    useSensor(KeyboardSensor),
  );

  const boardKey = queryKeys.board(projectId, keyword, prioFilter);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: boardKey,
    queryFn: () => apiGet<{ columns: BoardColumn[]; total: number }>(`/api/v1/projects/${projectId}/work-items/board`, { pageSizePerColumn: 25, q: keyword || undefined, priority: prioFilter || undefined }),
  });

  /**
   * 工作流配置可能为同一个项目返回多套状态模板，服务端会把它们展开成重复的
   * stateKey。看板的视觉与拖拽语义都以 stateKey 为列，因此这里在视图层合并：
   * 同一状态只保留一列，工作项按 id 去重，保留服务端给出的首个顺序与颜色。
   */
  const columns = useMemo(() => {
    const grouped = new Map<string, BoardColumn>();
    for (const source of data?.columns ?? []) {
      const current = grouped.get(source.stateKey);
      if (!current) {
        grouped.set(source.stateKey, { ...source, items: [...source.items] });
        continue;
      }
      const items = new Map(current.items.map((item) => [item.id, item]));
      for (const item of source.items) items.set(item.id, item);
      current.items = [...items.values()];
      current.count = Math.max(current.count, source.count, current.items.length);
      current.truncated = current.truncated || source.truncated;
      current.wipLimit = current.wipLimit ?? source.wipLimit ?? null;
    }
    return [...grouped.values()];
  }, [data?.columns]);
  const mergedColumns = useMemo(() => columns.map((c) => ({ ...c, items: [...c.items, ...(extraByColumn[c.stateKey] ?? [])] })), [columns, extraByColumn]);
  const flat = useMemo(() => mergedColumns.flatMap((c) => c.items.map((i) => ({ ...i, stateKey: c.stateKey }))), [mergedColumns]);
  const activeItem = activeId ? flat.find((i) => i.id === activeId) ?? null : null;

  /** 从某列移除并插入目标列（乐观更新） */
  async function move(itemId: string, toStateKey: string, version: number, fields?: Record<string, unknown>) {
    setActionError(null);
    const prev = qc.getQueryData<{ columns: BoardColumn[] }>(boardKey);
    if (prev) {
      const found = flat.find((i) => i.id === itemId);
      const item = found;
      if (item) {
        // 乐观更新必须同步调整 count（列头徽章与「加载更多」都读它），
        // 否则拖拽后源列计数滞后一根烟的时间（2026-11-01 走查实测）
        const next = {
          ...prev,
          columns: mergedColumns.map((c) => {
            const isTarget = c.stateKey === toStateKey;
            const isSource = c.stateKey === item.stateKey;
            return {
              ...c,
              count: isTarget ? c.count + 1 : isSource ? Math.max(0, c.count - 1) : c.count,
              items: isTarget
                ? [{ ...item, version: version + 1 }, ...c.items.filter((i) => i.id !== itemId)]
                : isSource
                  ? c.items.filter((i) => i.id !== itemId)
                  : c.items,
            };
          }),
        };
        setExtraByColumn({});
        qc.setQueryData(boardKey, next);
      }
    }
    try {
      const updated = await apiPost<{ version: number; status: { key: string } }>(
        `/api/v1/work-items/${itemId}/transition`,
        { toStateKey, version, fields: fields ?? {} },
      );
      toast.info(t("board.statusUpdated"));
      await invalidateWorkItemQueries(qc, itemId);
      void updated;
      return true;
    } catch (e) {
      // 回滚：用服务端数据重新拉取，避免本地状态与服务端分叉
      await qc.invalidateQueries({ queryKey: boardKey });
      if (e instanceof ApiError) {
        if (e.code === "VERSION_CONFLICT") {
          setActionError(t("board.conflictRefresh"));
        } else if (e.requiredFields.length > 0) {
          setNeedFields({ itemId, version, toStateKey, fields: e.requiredFields });
          setFieldValues({});
          return false;
        } else {
          setActionError(e.message);
        }
      } else {
        setActionError(t("board.actionFailed"));
      }
      return false;
    }
  }

  const retryWithFields = useMutation({
    mutationFn: async () => {
      if (!needFields) return;
      const fields = Object.fromEntries(needFields.fields.map((f) => [f, fieldValues[f] ?? ""]));
      if (await move(needFields.itemId, needFields.toStateKey, needFields.version, fields)) setNeedFields(null);
    },
  });

  useEffect(() => {
    setExtraByColumn({});
    setLoadingColumn(null);
    return () => { pageRequests.current = {}; };
  }, [data, projectId, keyword, prioFilter]);

  async function loadMore(stateKey: string, current: number) {
    if (pageRequests.current[stateKey]) return;
    const request = Symbol(stateKey);
    const requestScope = boardScope;
    pageRequests.current[stateKey] = request;
    setLoadingColumn(stateKey);
    try {
      const r = await apiGet<{ items: BoardItem[]; count: number }>(`/api/v1/projects/${projectId}/work-items/board/columns/${stateKey}`, { offset: current, limit: 25, q: keyword || undefined, priority: prioFilter || undefined });
      if (boardScopeRef.current !== requestScope || pageRequests.current[stateKey] !== request) return;
      setExtraByColumn((prev) => {
        const existing = prev[stateKey] ?? [];
        const seen = new Set([...columns.find((c) => c.stateKey === stateKey)?.items ?? [], ...existing].map((i) => i.id));
        return { ...prev, [stateKey]: [...existing, ...r.items.filter((i) => !seen.has(i.id))] };
      });
    } catch (e) {
      if (boardScopeRef.current === requestScope && pageRequests.current[stateKey] === request) setActionError(e instanceof ApiError ? e.message : t("common.loadFailedShort"));
    } finally {
      if (pageRequests.current[stateKey] === request) {
        delete pageRequests.current[stateKey];
        setLoadingColumn((loading) => loading === stateKey ? null : loading);
      }
    }
  }
  const filteredColumns = mergedColumns;



  /**
   * 根容器用 `.board-root` 撑满可用高度。
   * ⚠️ 原先写 `height: "100%"` —— 父级没有确定高度时它**等于 0**，列于是只按内容高度渲染，
   * 下面留一大片空白（实测发现）。
   */
  const updateScrollState = useCallback(() => {
    const el = boardScrollRef.current;
    if (!el) { setCanScrollLeft(false); setCanScrollRight(false); return; }
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);
  useEffect(() => {
    const el = boardScrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateScrollState) : null;
    observer?.observe(el);
    updateScrollState();
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      observer?.disconnect();
    };
  }, [laneBy, filteredColumns.length, flat.length, isLoading, isError, updateScrollState]);
  const scrollBoard = (direction: -1 | 1) => {
    boardScrollRef.current?.scrollBy({ left: direction * 360, behavior: "smooth" });
  };

  return (
    <div className={`page workspace-page project-refinement board-root${activeId ? " is-dragging" : ""}`}>
      <WorkItemViewHeader projectId={projectId!} active="board"
        onCreate={() => setCreateOpen(true)}
        onRefresh={() => void qc.invalidateQueries({ queryKey: boardKey })} />
      <p className="muted work-items-help">{t("wiv.boardHelp")}</p>
      <div className="board-filter-row">
        <div className="board-filters" role="group" aria-label={t("board.filters")}>
          <TextInput style={{ width: 240 }} placeholder={t("board.searchPlaceholder")} aria-label={t("board.searchPlaceholder")}
            value={q} onChange={(e) => setQ(e.target.value)} />
          <Select ariaLabel={t("common.priority")} value={prioFilter} onChange={setPrioFilter}
            options={[{ value: "", label: t("common.priority") }, ...["URGENT", "HIGH", "MEDIUM", "LOW", "LOWEST"].map((value) => ({ value, label: t(PRIORITY_LABEL[value]!) }))]} />
          <Select ariaLabel={t("board.groupBy")} value={laneBy} onChange={(v) => setLaneBy(v as "none" | "priority")}
            options={[{ value: "none", label: t("board.groupNone") }, { value: "priority", label: t("board.groupPriority") }]} />
          {(q || prioFilter) && <Button size="sm" variant="ghost" onClick={() => { setQ(""); setPrioFilter(""); }}>{t("board.clearFilters")}</Button>}
        </div>
        {!isLoading && !isError && (laneBy === "none" || !flat.length) && <div className="board-scroll-controls" role="group" aria-label={t("board.horizontalScroll")}>
          <Button size="sm" variant="ghost" iconOnly disabled={!canScrollLeft} aria-label={t("board.scrollLeft")}
            onClick={() => scrollBoard(-1)}><Icon name="chevron-left" /></Button>
          <Button size="sm" variant="ghost" iconOnly disabled={!canScrollRight} aria-label={t("board.scrollRight")}
            onClick={() => scrollBoard(1)}><Icon name="chevron-right" /></Button>
        </div>}
      </div>
      {actionError && !needFields && <div className="board-action-error alert-error" role="alert">
        <span>{actionError}</span>
        <Button size="sm" variant="ghost" onClick={() => void refetch()}>{t("common.reload")}</Button>
        <Button size="sm" variant="ghost" onClick={() => setActionError(null)}>{t("common.close")}</Button>
      </div>}
      {isLoading && <StateBlock kind="loading" title={t("common.loading")} />}
      {isError && <StateBlock kind="error" title={t("common.loadFailedShort")} description={error instanceof ApiError ? error.message : undefined}
        action={() => void refetch()} actionLabel={t("common.reload")} />}
      {!isLoading && !isError && !columns.length && <StateBlock kind="empty" title={t("common.noData")} />}
      {!isLoading && !isError && columns.length > 0 && !flat.length && <div className="board-empty-notice" role="status">
        <Icon name="inbox" size={16} />
        <span>{keyword || prioFilter ? t("common.noMatches") : t("common.noData")}</span>
        {keyword || prioFilter
          ? <Button size="sm" variant="ghost" onClick={() => { setQ(""); setKeyword(""); setPrioFilter(""); }}>{t("board.clearFilters")}</Button>
          : <Button size="sm" variant="ghost" onClick={() => setCreateOpen(true)}><Icon name="plus" size={14} />{t("wie.create")}</Button>}
      </div>}
      {!isLoading && !isError && laneBy === "priority" && mergedColumns.some((col) => col.items.length < col.count) && <div className="toolbar">
        {mergedColumns.filter((col) => col.items.length < col.count).map((col) => <Button key={col.stateKey} size="sm" loading={loadingColumn === col.stateKey}
          onClick={() => void loadMore(col.stateKey, col.items.length)}>{col.name} · {t("board.loadMore", { n: col.count - col.items.length })}</Button>)}
      </div>}

      {!isLoading && !isError && columns.length > 0 && <DndContext
        sensors={sensors}
        collisionDetection={(args) => args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)}
        onDragStart={(e) => setActiveId(String(e.active.id))}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={(e) => {
          setActiveId(null);
          const overRaw = e.over?.id ? String(e.over.id) : null;
          const over = overRaw ? overRaw.split("::")[0]! : null;
          const itemId = String(e.active.id);
          const item = flat.find((i) => i.id === itemId);
          if (!over || !item || item.stateKey === over) return;
          void move(itemId, over, item.version);
        }}
      >
        {laneBy === "none" || !flat.length ? (
          <div ref={boardScrollRef} className="board-columns" data-custom-scroll>
            {filteredColumns.map((c) => <Column key={c.stateKey} col={c} activeId={activeId} onOpen={setSelectedId}
              onLoadMore={() => void loadMore(c.stateKey, c.items.length)} loadingMore={loadingColumn === c.stateKey} />)}
          </div>
        ) : (
          <div className="board-swimlanes" data-custom-scroll>
            {(["URGENT", "HIGH", "MEDIUM", "LOW", "LOWEST", ""] as const).map((lane) => {
              const laneColumns = filteredColumns.map((c) => ({ ...c, items: c.items.filter((i) => (lane ? i.priority === lane : !i.priority)) }));
              if (!laneColumns.some((c) => c.items.length > 0)) return null;
              return (
                <section className="board-lane" key={lane || "none"} aria-label={lane || t("board.noPriority")}>
                  <div className="board-lane-head">
                    <span className={`status-pill ${lane === "URGENT" || lane === "HIGH" ? "dot-red" : lane === "MEDIUM" ? "dot-blue" : "dot-green"}`}>{lane ? t(PRIORITY_LABEL[lane]!) : t("board.noPriority")}</span>
                  </div>
                  <div className="board-columns board-lane-columns" data-custom-scroll>
                    {laneColumns.map((c) => (
                      <Column key={`${c.stateKey}-${lane || "none"}`} col={c} activeId={activeId} onOpen={setSelectedId}
                        dropId={`${c.stateKey}::${lane || "none"}`} showTotal={false} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
        <DragOverlay>
          {activeItem ? (
            <div className="card" style={{ padding: 10, width: 240 }}>
              <div className="mono muted" style={{ fontSize: "var(--text-xs)" }}>{activeItem.key}</div>
              <div style={{ fontSize: "var(--text-sm)" }}>{activeItem.title}</div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>}

      <Drawer open={!!needFields} title={t("board.needFields")} onClose={() => !retryWithFields.isPending && setNeedFields(null)}>
        <p className="muted" style={{ fontSize: "var(--text-sm)", marginTop: 0 }}>{t("board.needFieldsHint")}</p>
        {actionError && <p className="alert-error" role="alert">{actionError}</p>}
        {needFields?.fields.map((f) => (
          <TextArea key={f} id={`f-${f}`} label={f} rows={3} value={fieldValues[f] ?? ""}
            onChange={(e) => setFieldValues({ ...fieldValues, [f]: e.target.value })} />
        ))}
        <div className="drawer-actions">
          <Button variant="ghost" onClick={() => setNeedFields(null)} disabled={retryWithFields.isPending}>{t("board.cancel")}</Button>
          <Button variant="primary" loading={retryWithFields.isPending} onClick={() => retryWithFields.mutate()}
            disabled={!needFields || needFields.fields.some((f) => !(fieldValues[f] ?? "").trim())}>
            {t("board.submit")}
          </Button>
        </div>
      </Drawer>

      <WorkItemDrawer workItemId={selectedId} onClose={() => setSelectedId(null)} />
      <WorkItemEditor open={createOpen} projectId={projectId} onClose={() => setCreateOpen(false)}
        onSaved={(item) => { setCreateOpen(false); setSelectedId(item.id); }} />
    </div>
  );
}
