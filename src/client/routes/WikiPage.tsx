/**
 * Wiki 页面（第十二期）
 *
 * 四处刻意的设计：
 *   1 **受限页在树上有明确标记** —— 否则用户会以为"文档消失了"（可见性是过滤而非删除）
 *   2 保存带 `expectedRevisionId`（乐观锁）：冲突时给出可读提示并让用户重新载入，不静默覆盖
 *   3 版本历史可直接回滚，并说明回滚是**新增一个版本**（append-only），不是删除历史
 *   4 默认阅读 Markdown；编辑草稿显式保存，并保护切页和离开时的未保存内容。
 */
import { useEffect, useRef, useState } from "react";
import { Link, useBlocker, useParams, useSearch } from "@tanstack/react-router";
import { KnowledgePanel } from "../components/KnowledgePanel.tsx";
import { CommentsPanel } from "./CommentsPanel.tsx";
import { AttachmentsPanel } from "../components/work-item/AttachmentsPanel.tsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut, apiPatch, apiDelete, ApiError } from "../lib/api.ts";
import { draftImageTokens, useMarkdownImages } from "../lib/useMarkdownImages.ts";
import { t as tr, useLocale } from "../i18n/index.ts";
import { Checkbox } from "../components/Checkbox.tsx";
import { Select } from "../components/Select.tsx";
import { confirmDialog } from "../components/Dialog.tsx";
import { PageHead } from "../components/Page.tsx";
import { StateBlock } from "../components/ui/StateBlock.tsx";
import { Tree } from "../components/ui/Tree.tsx";
import { MarkdownEditor } from "../components/ui/MarkdownEditor.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { MarkdownView } from "../components/ui/MarkdownView.tsx";
import { Button } from "../components/ui/Button.tsx";
import { toast } from "../components/ui/Toast.tsx";
import type { TreeNode } from "../components/ui/Tree.tsx";
import { Icon } from "../components/Icon.tsx";
import { useActor, useCan } from "../lib/actor.ts";
import { useCollabDocument } from "../lib/collab-provider.ts";

interface PageRow {
  id: string; title: string; slug: string; parentId: string | null;
  visibility: "PROJECT" | "RESTRICTED"; sortOrder: number; currentRevisionId: string | null;
  /** 接口**本来就返回**它（wiki.service 的 listPages 里选了 updatedAt），只是本类型此前没声明 */
  updatedAt: string | null;
}
interface PageDetail extends PageRow { content: string; revisionNo: number; changeSummary: string | null }
interface Revision { id: string; revisionNo: number; changeSummary: string | null; authorId: string; createdAt: string }
interface Member { id: string; username: string; name: string; role_key: string | null; role_name: string | null }
interface Permission { principalType: string; principalId: string; canRead: boolean; canWrite: boolean }
interface PageDraft {
  pageId: string; title: string; content: string;
  originalTitle: string; originalContent: string; revisionId: string | null;
}

function draftFromPage(page: PageDetail): PageDraft {
  return { pageId: page.id, title: page.title, content: page.content,
    originalTitle: page.title, originalContent: page.content, revisionId: page.currentRevisionId };
}

export function WikiPage() {
  useLocale();   // 订阅语言，切换即时生效
  const { projectId } = useParams({ from: "/_app/projects/$projectId/wiki" });
  const { page: requestedPage } = useSearch({ from: "/_app/projects/$projectId/wiki" });
  const qc = useQueryClient();
  const actor = useActor();
  const canReindex = useCan("page:update_any");
  const [selected, setSelected] = useState<string | null>(requestedPage ?? null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<PageDraft | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [grantMember, setGrantMember] = useState("");
  const [grantWrite, setGrantWrite] = useState(false);
  const images = useMarkdownImages();
  const uploadingImage = images.images.some(image => image.status === "uploading");
  const resetImages = images.reset;
  const saveLock = useRef(false);
  const [editing, setEditing] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [support, setSupport] = useState<"attachments" | "comments" | "history" | "access" | null>(null);
  const [ragOpen, setRagOpen] = useState(false);
  const dirty = editing && !!draft && (draft.title !== draft.originalTitle || draft.content !== draft.originalContent);
  // 命令面板定位到命中的文档；导航前仍由下方 blocker 保护未保存内容。
  useEffect(() => {
    resetImages(); setSelected(requestedPage ?? null); setEditing(false); setDraft(null); setErr(null); setSupport(null);
  }, [projectId, requestedPage, resetImages]);

  const isSearch = query.trim().length > 0;
  const tree = useQuery({
    queryKey: ["wiki-tree", projectId, query, isSearch],
    queryFn: () => apiGet<{ pages: PageRow[] }>(
      `/api/v1/projects/${projectId}/pages${isSearch ? `?q=${encodeURIComponent(query.trim())}` : ""}`),
  });
  const detail = useQuery({
    queryKey: ["wiki-page", selected],
    queryFn: () => apiGet<PageDetail>(`/api/v1/pages/${selected}`),
    enabled: !!selected,
  });
  const revisions = useQuery({
    queryKey: ["wiki-revisions", selected],
    queryFn: () => apiGet<{ revisions: Revision[] }>(`/api/v1/pages/${selected}/revisions`),
    enabled: !!selected,
  });
  const members = useQuery({
    queryKey: ["members", projectId],
    queryFn: () => apiGet<{ members: Member[] }>(`/api/v1/projects/${projectId}/members`),
  });
  const perms = useQuery({
    queryKey: ["wiki-perms", selected],
    queryFn: () => apiGet<{ permissions: Permission[] }>(`/api/v1/pages/${selected}/permissions`),
    enabled: !!selected && detail.data?.visibility === "RESTRICTED",
  });
  const collab = useCollabDocument(selected, draft?.content ?? detail.data?.content ?? "", editing && !!draft, actor.memberId);

  useEffect(() => {
    if (!editing || !draft || collab.status !== "ready" || draft.content === collab.content) return;
    setDraft((current) => current ? { ...current, content: collab.content } : current);
  }, [collab.content, collab.status, draft, editing]);

  // 编辑期间保留草稿及其起始版本，后台刷新不能覆盖输入或绕过乐观锁。
  useEffect(() => {
    if (detail.data && !editing) setDraft(draftFromPage(detail.data));
  }, [detail.data, editing]);

  const discardChanges = async (): Promise<boolean> => !save.isPending && (!dirty || await confirmDialog(tr("wk.discardChanges"), { danger: true }));
  const selectPage = async (id: string) => {
    if (save.isPending) return;
    if (id !== selected && !(await discardChanges())) return;
    if (id !== selected) {
      images.reset(); setEditing(false); setDraft(null); setSupport(null); setErr(null); setSelected(id);
    }
    setDirectoryOpen(false);
  };
  const beginEditing = () => {
    if (!detail.data || save.isPending) return;
    images.reset(); setDraft(draftFromPage(detail.data)); setEditing(true); setErr(null);
  };
  const cancelEditing = async () => {
    if (!(await discardChanges())) return;
    images.reset(); setEditing(false); setErr(null);
  };
  const reload = async () => {
    if (!(await discardChanges())) return;
    images.reset(); setEditing(false); setErr(null);
    await detail.refetch();
  };

  const invalidate = async (pageId = selected) => {
    await qc.invalidateQueries({ queryKey: ["wiki-tree", projectId] });
    await qc.invalidateQueries({ queryKey: ["wiki-page", pageId] });
    await qc.invalidateQueries({ queryKey: ["wiki-revisions", pageId] });
  };
  const onErr = (e: unknown, fallback: string) => setErr(e instanceof ApiError ? e.message : fallback);

  const create = useMutation({
    mutationFn: () => apiPost<PageRow>(`/api/v1/projects/${projectId}/pages`, { title: tr("wk.untitledDoc"), content: "" }),
    onSuccess: async (p) => {
      setSelected(p.id);
      setDraft({ pageId: p.id, title: p.title, content: "", originalTitle: p.title, originalContent: "", revisionId: p.currentRevisionId });
      images.reset(); setEditing(true); setErr(null);
      setDirectoryOpen(false); setSupport(null); await invalidate();
    },
    onError: (e) => onErr(e, tr("wk.createFailed")),
  });

  const save = useMutation({
    mutationFn: async (submitted: PageDraft) => {
      // 已进入协作的编辑只经草稿发布，网络异常时不可退回整篇PATCH覆盖其他人的草稿。
      if (!collab.readyToEdit) throw new Error("协作文档尚未连接，请等待连接后保存");
      if (draftImageTokens(submitted.content).length) throw new Error("正文包含尚未上传的图片，请重新插入图片后保存");
      await collab.flush();
      const published = await apiPost<{ page: PageRow & { revisionNo: number; content: string }; publishedRevisionId: string; indexing: { status: string; message?: string } }>(`/api/v1/collaboration/rooms/PAGE/${submitted.pageId}/publish`, {
        title: submitted.title,
        expectedRevisionId: collab.baseRevisionId ?? submitted.revisionId,
        userConfirmed: true,
        changeSummary: "Wiki 协作草稿发布",
      });
      if (published.indexing.status === "FAILED") setErr(`页面已发布，但知识索引启动失败：${published.indexing.message ?? "未知原因"}`);
      return { metadata: published.page, content: published.page.content, indexing: published.indexing };
    },
    onSuccess: async ({ metadata, content, indexing }, submitted) => {
      // 展示服务端发布的合并正文，不能用点击保存时的旧快照覆盖并发修改。
      const page: PageDetail = { ...metadata, content, changeSummary: null };
      qc.setQueryData(["wiki-page", submitted.pageId], page);
      if (selected === submitted.pageId) {
        images.reset(); setDraft(draftFromPage(page)); setEditing(false);
        setErr(indexing?.status === "FAILED" ? `页面已发布，但知识索引启动失败：${indexing.message ?? "未知原因"}` : null);
      }
      if (indexing?.status === "FAILED") toast.error("页面已发布，但知识索引启动失败");
      toast.success(tr("wk.saved")); await invalidate(submitted.pageId);
      await qc.invalidateQueries({ queryKey: ["attachments", "PAGE", submitted.pageId] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "VERSION_CONFLICT") {
        setErr(tr("wk.conflict"));
      } else setErr(e instanceof Error ? e.message : tr("wk.saveFailed"));
    },
    onSettled: () => { saveLock.current = false; },
  });
  const submitDraft = () => {
    if (!draft || !dirty || !draft.title.trim() || saveLock.current || save.isPending || !collab.readyToEdit || uploadingImage) return;
    saveLock.current = true; save.mutate(draft);
  };

  useBlocker({
    disabled: !dirty && !save.isPending,
    enableBeforeUnload: dirty || save.isPending,
    shouldBlockFn: async () => save.isPending || !(await confirmDialog(tr("wk.discardChanges"), { danger: true })),
  });

  const setVisibility = useMutation({
    mutationFn: (v: "PROJECT" | "RESTRICTED") => apiPatch<PageDetail>(`/api/v1/pages/${selected}`, { visibility: v }),
    onSuccess: async () => { setErr(null); await invalidate(); },
    onError: (e) => onErr(e, tr("wk.visibilityFailed")),
  });

  const restore = useMutation({
    mutationFn: (revId: string) => apiPost(`/api/v1/pages/${selected}/revisions/${revId}/restore`, {}),
    onSuccess: async () => { toast.success(tr("wk.rolledBack")); await invalidate(); },
    onError: (e) => onErr(e, tr("wk.rollbackFailed")),
  });

  const remove = useMutation({
    mutationFn: () => apiDelete(`/api/v1/pages/${selected}`),
    onSuccess: async () => { setSelected(null); setDraft(null); setEditing(false); await invalidate(); },
    onError: (e) => onErr(e, tr("wk.deleteFailed")),
  });

  const savePerms = useMutation({
    mutationFn: (next: Permission[]) => apiPut(`/api/v1/pages/${selected}/permissions`, { permissions: next }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["wiki-perms", selected] }); },
    onError: (e) => onErr(e, tr("wk.grantFailed")),
  });

  const pages = tree.data?.pages ?? [];

  // 照原型：右栏默认显示**第一篇文档正文**（原型一进页面右栏就有内容，我此前是空白提示）
  useEffect(() => {
    if (!selected && pages.length > 0) setSelected(pages[0]!.id);
  }, [pages, selected]);

  const roots = pages.filter((p) => !p.parentId);
  const childrenOf = (id: string) => pages.filter((p) => p.parentId === id);
  // 共享 Tree（a11y：role=tree/treeitem + 展开收起 + 键盘）；默认全部收起
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set<string>());
  const toggleExpanded = (id: string) => setExpandedIds((prev) => {
    const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const toTreeNode = (page: PageRow, ancestors = new Set<string>()): TreeNode => ({
    id: page.id, label: page.title,
    extra: page.visibility === "RESTRICTED" ? <span className="tag tag-warning">{tr("wk.restricted")}</span> : undefined,
    children: isSearch ? [] : childrenOf(page.id).filter((child) => !ancestors.has(child.id))
      .map((child) => toTreeNode(child, new Set([...ancestors, page.id]))),
  });
  const treeNodes: TreeNode[] = (isSearch ? pages : roots).map((page) => toTreeNode(page));
  const visibleStatus = detail.data?.visibility === "RESTRICTED";

  return (
    <div className="page workspace-page project-refinement knowledge-page wiki-workspace">
      {/* 标题行：规范第 3 节要求「其他页面复用相同的标题行」——
          此前本页**完全没有标题**（既无 .page-title 也无 h1），已由键名/结构检查器如实拦下。
          标题复用已有的 nav.wiki（与侧栏命名一致），**不新造文案**。 */}
      <PageHead title={tr("nav.knowledge")}
        actions={<>
          <Button size="sm" className="wiki-directory-toggle" aria-expanded={directoryOpen} aria-controls="wiki-directory"
            onClick={() => setDirectoryOpen((value) => !value)}><Icon name="list" size={14} />{tr("wk.contents")}</Button>
          <Button size="sm" variant={ragOpen ? "primary" : "secondary"} aria-expanded={ragOpen} aria-controls="wiki-knowledge"
            onClick={() => setRagOpen((value) => !value)}><Icon name="book" size={14} />{tr("kn.indexTitle")}</Button>
          <Button size="sm" variant="primary" loading={create.isPending} disabled={save.isPending} onClick={async () => {
            if (await discardChanges()) create.mutate();
          }}><Icon name="plus" size={14} />{tr("wk.new")}</Button>
        </>} />
      <div className="wiki-layout" data-rag-open={ragOpen ? "true" : "false"} data-directory-open={directoryOpen ? "true" : "false"}>
      {/* 左：树 + 检索 */}
      <aside className="wiki-directory" id="wiki-directory" aria-label={tr("wk.contents")}>
        {/* 照原型：搜索行在**面板内**（原型第一个面板 y=220 = 页头底 195 + 24，
            我此前把搜索放在面板外 → 面板被推低 49px，实测 panel.y 268 vs 220） */}
        <div className="wiki-tree-panel">
          <div className="wiki-directory-head">
            <h2>{tr("wk.contents")}</h2>
            {tree.isSuccess && <span>{tr("wk.documentsCount", { n: String(pages.length) })}</span>}
          </div>
          <div className="wiki-directory-search">
            <TextInput placeholder={tr("wiki.searchPlaceholder")} aria-label={tr("wiki.searchLabel")} value={query}
              onChange={(e) => setQuery(e.target.value)} />
          </div>
        <div className="wiki-tree-scroll" data-custom-scroll>
          {isSearch && tree.isSuccess && <p className="muted wiki-search-count">{tr("wk.searchResults", { n: String(pages.length) })}</p>}
          {tree.isLoading ? <StateBlock kind="loading" title={tr("common.loading")} />
            : tree.isError ? <StateBlock kind="error" title={tr("wk.directoryFailed")} action={() => void tree.refetch()} actionLabel={tr("common.reload")} /> : <>
          {/* 共享 Tree：a11y（role=tree/treeitem、aria-expanded/selected/level）+ 展开收起 + 键盘 */}
          <Tree
            nodes={treeNodes}
            selectedId={selected}
            expandedIds={expandedIds}
            onSelect={(id) => { void selectPage(id); }}
            onToggle={toggleExpanded}
            ariaLabel={tr("nav.wiki")}
            emptyText={isSearch ? tr("wk.noMatch") : tr("wk.empty")}
          />
          </>}
        </div>
        </div>

        <details className="wiki-recent-panel">
          <summary>{tr("wk.recent")}</summary>
          <ul>
            {[...pages]
              .filter((pg) => pg.updatedAt)
              .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
              .slice(0, 5)
              .map((pg) => (
                <li key={pg.id}>
                  <button className="wiki-recent-item" type="button" aria-current={selected === pg.id ? "page" : undefined}
                    onClick={() => { void selectPage(pg.id); }}>{pg.title}</button>
                </li>
              ))}
          </ul>
        </details>
        <Link to="/projects" className="muted wiki-project-back">{tr("wk.back")}</Link>
      </aside>

      {/* 中栏：文档正文与授权、版本信息。 */}
      <div className="wiki-editor-column">
        {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div>}
        {!selected && tree.isSuccess && <StateBlock kind="empty" title={tr("wk.pickOrCreate")} />}

        {selected && detail.isLoading && <StateBlock kind="loading" title={tr("common.loading")} />}
        {selected && detail.isError && (
          <StateBlock kind={detail.error instanceof ApiError && detail.error.status === 403 ? "restricted" : "error"}
            title={tr(detail.error instanceof ApiError && detail.error.status === 403 ? "wk.notVisible" : detail.error instanceof ApiError && detail.error.status === 404 ? "wk.notFound" : "wk.loadFailed")}
            action={() => void detail.refetch()} actionLabel={tr("common.reload")} />
        )}

        {selected && detail.data && (
          <>
            <article className="wiki-edit-panel" aria-label={detail.data.title} aria-busy={save.isPending} data-editing={editing ? "true" : "false"}>
              <div className="wiki-document-toolbar">
                <span className="wiki-document-state">{save.isPending ? tr("common.saving") : editing ? (dirty ? tr("wk.unsaved") : tr("wk.editingHint")) : tr("wk.reading")}</span>
                {editing && <span className={`status-pill ${collab.status === "ready" ? "dot-green" : collab.status === "error" ? "dot-amber" : "dot-blue"}`} aria-live="polite">
                  {tr(`wk.collab.${collab.status}`)}
                </span>}
                {editing && collab.members.length > 0 && <span className="muted">{tr("wk.collabMembers", { count: String(new Set(collab.members.map((member) => member.memberId)).size) })}</span>}
                <div className="wiki-primary-actions">
                  {editing ? <>
                    <Button size="sm" onClick={() => { void cancelEditing(); }} disabled={save.isPending}>{tr("wk.cancelEdit")}</Button>
                    <Button size="sm" variant="primary" loading={save.isPending} disabled={!dirty || !draft?.title.trim() || !collab.readyToEdit || uploadingImage}
                      onClick={submitDraft}><Icon name="check" size={14} />{tr("wk.saveChanges")}</Button>
                  </> : <Button size="sm" variant="primary" disabled={save.isPending} onClick={beginEditing}>{tr("wk.edit")}</Button>}
                </div>
              </div>
              <div className="wiki-doc-head">
                {editing && draft ? <TextInput aria-label={tr("wiki.titleLabel")} inputClassName="wiki-title-input" autoFocus disabled={save.isPending}
                  value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                  : <h2 className="wiki-document-title">{detail.data.title}</h2>}
                <div className="wiki-doc-meta">
                  <span className={`status-pill ${visibleStatus ? "dot-amber" : "dot-blue"}`}>
                    {visibleStatus ? tr("wk.restricted2") : tr("wk.projectVisible")}
                  </span>
                  <span>{tr("wk.revisionNo", { n: String(detail.data.revisionNo) })}</span>
                  {detail.data.updatedAt && <span>{new Date(detail.data.updatedAt).toLocaleString()}</span>}
                </div>
              </div>
              {editing && draft ? <MarkdownEditor key={draft.pageId} label={tr("wiki.bodyLabel")} rows={16} className="wiki-markdown-editor" disabled={save.isPending || !collab.readyToEdit}
                  imageTarget={{ type: "PAGE", id: draft.pageId }}
                  value={draft.content} images={images} onChange={(content) => { collab.setContent(content); setDraft((current) => current ? { ...current, content } : current); }}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && dirty && draft.title.trim() && !save.isPending) {
                      event.preventDefault(); submitDraft();
                    }
                  }} placeholder={tr("wk.bodyPlaceholder")} /> : <div className="wiki-reading-body">
                {detail.data.content.trim() ? <MarkdownView text={detail.data.content} /> : <p className="muted">{tr("wk.previewEmpty")}</p>}
              </div>}
            <div className="wiki-support-nav" role="group" aria-label={tr("wk.documentOptions")}>
              {(["comments", "attachments", "history", "access"] as const).map((section) => (
                <Button key={section} size="sm" variant={support === section ? "secondary" : "ghost"}
                  aria-expanded={support === section} aria-controls={`wiki-support-${section}`}
                  onClick={() => setSupport((current) => current === section ? null : section)}>
                  {tr(section === "history" ? "wk.versions" : `wk.${section}`)}
                </Button>
              ))}
              <details className="wiki-more-actions">
                <summary aria-label={tr("wk.documentOptions")}><Icon name="more" size={16} /></summary>
                <div>
                  <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => { void reload(); }}>{tr("wk.reload")}</Button>
                  <Button size="sm" variant="danger" disabled={remove.isPending || save.isPending} onClick={async () => {
                    if (await discardChanges() && await confirmDialog(tr("wk.deleteConfirm"), { danger: true })) remove.mutate();
                  }}><Icon name="trash" size={14} />{tr("wk.delete")}</Button>
                </div>
              </details>
            </div>

            {support === "access" && (
              <section className="wiki-support-panel" id="wiki-support-access" aria-label={tr("wk.access")}>
                <div className="wiki-access-head">
                  <h3>{tr("wk.access")}</h3>
                  <Button size="sm" disabled={editing || setVisibility.isPending}
                    onClick={() => setVisibility.mutate(visibleStatus ? "PROJECT" : "RESTRICTED")}>
                    {visibleStatus ? tr("wk.toProjectVisible") : tr("wk.toRestricted")}
                  </Button>
                </div>
                {visibleStatus && <>
                <strong style={{ fontSize: "var(--text-sm)" }}>{tr("wk.grants")}</strong>
                <p className="muted" style={{ fontSize: "var(--text-xs)", margin: "6px 0 10px" }}>
                  {tr("wk.grantHint")}
                </p>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Select value={grantMember} ariaLabel={tr("wiki.memberLabel")} size="sm" onChange={setGrantMember}
                    options={[{ value: "", label: tr("wk.pickMember") },
                      ...(members.data?.members ?? []).map((m) => ({ value: m.id, label: m.name ?? m.username ?? m.id }))]} />
                  <label className="muted" style={{ fontSize: "var(--text-sm)" }}>
                    <Checkbox checked={grantWrite} onChange={setGrantWrite} ariaLabel={tr("wk.allowEdit")} size="sm" /> {tr("wk.allowEdit")}
                  </label>
                  <Button size="sm" disabled={!grantMember || !perms.isSuccess || savePerms.isPending}
                    onClick={() => {
                      const next = [
                        ...(perms.data?.permissions ?? []).map((x) => ({ ...x })),
                        { principalType: "MEMBER", principalId: grantMember, canRead: true, canWrite: grantWrite },
                      ];
                      savePerms.mutate(next);
                    }}>{tr("wk.grant")}</Button>
                </div>
                {perms.isLoading && <StateBlock kind="loading" title={tr("common.loading")} />}
                {perms.isError && <StateBlock kind="error" title={tr("wk.permissionsFailed")} action={() => void perms.refetch()} actionLabel={tr("common.reload")} />}
                <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: "var(--text-sm)" }}>
                  {(perms.data?.permissions ?? []).map((x) => {
                    const m = (members.data?.members ?? []).find((mm) => mm.id === x.principalId);
                    return (
                      <li key={`${x.principalType}-${x.principalId}`}>
                        {x.principalType === "MEMBER" ? (m?.name ?? x.principalId) : `${x.principalType}:${x.principalId}`}
                        {" · "}{x.canRead ? tr("wk.read") : ""}{x.canWrite ? tr("wk.write") : ""}
                        {" "}
                        <Button variant="danger" size="sm" disabled={savePerms.isPending || !perms.isSuccess} onClick={async () => {
                          if (!(await confirmDialog(tr("wk.revokeConfirm"), { danger: true }))) return;
                          savePerms.mutate((perms.data?.permissions ?? []).filter((y) =>
                            !(y.principalType === x.principalType && y.principalId === x.principalId)));
                        }}>{tr("wk.revoke")}</Button>
                      </li>
                    );
                  })}
                </ul>
                </>}
              </section>
            )}

            {support === "history" && <section className="wiki-history-panel wiki-support-panel" id="wiki-support-history" aria-label={tr("wk.versions")}>
              <strong className="wiki-history-title">{tr("wk.versions")}</strong>
              <p className="muted" style={{ fontSize: "var(--text-xs)", margin: "6px 0 10px" }}>
                {tr("wk.rollbackHint")}
              </p>
              {revisions.isLoading && <StateBlock kind="loading" title={tr("common.loading")} />}
              {revisions.isError && <StateBlock kind="error" title={tr("wk.historyFailed")} action={() => void revisions.refetch()} actionLabel={tr("common.reload")} />}
              <div className="wiki-revision-list">
                {(revisions.data?.revisions ?? []).map((r) => (
                  <div key={r.id} className="wiki-revision-row row-hover">
                    <span>{tr("wk.revisionNo", { n: String(r.revisionNo) })}</span>
                    <span className="muted">{r.changeSummary ?? "—"}</span>
                    <span className="muted">{new Date(r.createdAt).toLocaleString()}</span>
                    <span>
                      {r.revisionNo !== detail.data!.revisionNo && (
                        <Button size="sm" disabled={restore.isPending} onClick={async () => {
                          if (await discardChanges() && await confirmDialog(tr("wk.rollbackHint"))) {
                            images.reset(); setEditing(false); restore.mutate(r.id);
                          }
                        }}>{tr("wk.rollbackTo")}</Button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
              {revisions.isSuccess && revisions.data.revisions.length === 0 && <p className="muted">{tr("wk.noRevisions")}</p>}
            </section>}
            <section className="wiki-support-panel wiki-bottom-panels" hidden={support !== "attachments"} id="wiki-support-attachments" aria-label={tr("wk.attachments")}>
              <AttachmentsPanel key={selected} targetType="PAGE" targetId={selected} />
            </section>
            <section className="wiki-support-panel wiki-bottom-panels" hidden={support !== "comments"} id="wiki-support-comments" aria-label={tr("wk.comments")}>
              <CommentsPanel key={selected} targetType="PAGE" targetId={selected} />
            </section>
            </article>
          </>
        )}
      </div>

      {/* 文档页只维护当前文档索引；对话在独立知识助手中进行。 */}
      {ragOpen && (
        <aside className="wiki-rag-column" id="wiki-knowledge" aria-label={tr("kn.indexTitle")}>
          <KnowledgePanel projectId={projectId} pageId={detail.data?.id} revisionId={detail.data?.currentRevisionId}
            canReindex={canReindex} indexOnly />
        </aside>
      )}
    </div>
    </div>
  );
}
