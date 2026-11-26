/**
 * 评论面板（T6）：顶层 + 回复，@用户名高亮。
 *
 * ⚠️ @提及高亮要按完整词切分渲染，不能把正文整段 innerHTML ——
 *    Markdown/HTML 注入是评论区的经典 XSS 入口。
 */
import { invalidateCommentQueries, queryKeys } from "../lib/query-keys.ts";
import { t, useLocale } from "../i18n/index.ts";
import { Button } from "../components/ui/Button.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { TextArea } from "../components/ui/TextArea.tsx";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { comments, type CommentRow } from "../lib/planning-api.ts";
import { ApiError } from "../lib/api.ts";
import { StateBlock } from "../components/ui/StateBlock.tsx";
import { AttachmentsPanel } from "../components/work-item/AttachmentsPanel.tsx";
import { useLocalDraft } from "../components/ui/LocalDraftScope.tsx";

/** 把正文里的 @用户名 切成片段，提及部分高亮（纯文本渲染，无 HTML 注入面） */
function renderBody(body: string) {
  const parts: { text: string; isMention: boolean }[] = [];
  const re = /@([a-z0-9][a-z0-9._-]{2,31})/g;
  let last = 0;
  for (const m of body.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) parts.push({ text: body.slice(last, i), isMention: false });
    parts.push({ text: m[0], isMention: true });
    last = i + m[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last), isMention: false });
  return parts.map((p, i) =>
    p.isMention
      ? <strong key={i} style={{ color: "var(--primary)" }}>{p.text}</strong>
      : <span key={i}>{p.text}</span>,
  );
}

function CommentItem({ c, targetType, targetId, readOnly }: {
  c: CommentRow; targetType: string; targetId: string; readOnly: boolean;
}) {
  const qc = useQueryClient();
  const [replyOpen, setReplyOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [replyText, setReplyText] = useState("");

  const reply = useMutation({
    mutationFn: () => comments.create({ targetType, targetId, body: replyText, parentId: c.id }),
    onSuccess: async () => {
      setReplyText(""); setReplyOpen(false);
      await invalidateCommentQueries(qc, targetType, targetId);
    },
  });
  useLocalDraft(!!replyText, reply.isPending);

  return (
    <div style={{ borderBottom: "1px solid var(--border)", padding: "8px 0" }}>
      <div style={{ fontSize: "var(--text-sm)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{renderBody(c.body)}</div>
      <div className="muted" style={{ fontSize: "var(--text-xs)", marginTop: 4, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span>{c.editedAt ? t("cmt.edited") : ""}{new Date(c.createdAt).toLocaleString()}</span>
        {!readOnly && !c.parentId && (
          <Button size="sm" variant="ghost" disabled={reply.isPending} aria-expanded={replyOpen} onClick={() => setReplyOpen(!replyOpen)}>{t("cmt.reply")}</Button>
        )}
        <Button size="sm" variant="ghost" aria-expanded={attachmentsOpen} onClick={() => setAttachmentsOpen((v) => !v)}>{t("att.title")}</Button>
      </div>
      {attachmentsOpen && <AttachmentsPanel targetType="COMMENT" targetId={c.id} readOnly={readOnly} />}
      {!readOnly && replyOpen && (
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <TextInput disabled={reply.isPending} placeholder={t("cmt.replyPlaceholder")} aria-label={t("cmt.replyPlaceholder")} value={replyText}
            onChange={(e) => setReplyText(e.target.value)} />
          <Button size="sm" variant="primary" disabled={!replyText.trim() || reply.isPending}
            onClick={() => reply.mutate()}>{t("cmt.send")}</Button>
        </div>
      )}
      {reply.isError && <p className="field-error" role="alert">{reply.error instanceof ApiError ? reply.error.message : t("cmt.failed")}</p>}
    </div>
  );
}

export function CommentsPanel({ targetType, targetId, readOnly = false }: { targetType: string; targetId: string; readOnly?: boolean }) {
  useLocale();   // 订阅语言
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: queryKeys.comments(targetType, targetId),
    queryFn: () => comments.list(targetType, targetId),
  });

  const add = useMutation({
    mutationFn: () => comments.create({ targetType, targetId, body: text }),
    onSuccess: async () => {
      setText(""); setError(null);
      await invalidateCommentQueries(qc, targetType, targetId);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("cmt.failed")),
  });
  useLocalDraft(!!text, add.isPending);

  const rows = Array.isArray(list.data) ? list.data : [];
  return (
    <div className="card comments-panel" style={{ padding: 16 }}>
      <strong style={{ fontSize: "var(--text-sm)" }}>{t("cmt.section")}</strong>
      {error && <div className="alert alert-error" style={{ marginTop: 8 }}>{error}</div>}
      {!readOnly && <div style={{ marginTop: 12 }}>
        {/* textarea 而非单行 input：长评论/@提及场景需要换行；Cmd/Ctrl+Enter 发送（走查 UX 清单 P1） */}
        <TextArea aria-label={t("cmt.placeholder")} placeholder={t("cmt.placeholder")} rows={3}
          disabled={add.isPending} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && text.trim() && !add.isPending) add.mutate(); }} />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <Button variant="primary" disabled={!text.trim() || add.isPending}
            onClick={() => add.mutate()}>{t("cmt.send")}</Button>
        </div>
      </div>}
      <div style={{ marginTop: 12 }}>
        {list.isLoading && <StateBlock kind="loading" title={t("common.loading")} />}
        {list.isError && <StateBlock kind="error" title={t("common.loadFailedShort")} action={() => void list.refetch()} actionLabel={t("common.reload")} />}
        {list.isSuccess && rows.length === 0 && <p className="muted" style={{ fontSize: "var(--text-sm)" }}>{t("cmt.empty")}</p>}
        {rows.map((c) => <CommentItem key={c.id} c={c} targetType={targetType} targetId={targetId} readOnly={readOnly} />)}
      </div>
    </div>
  );
}
