import { useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  ChangeStatus,
  RequirementChangeContext,
  RequirementChangeDetail,
  RequirementChangePage,
  RequirementImpactSnapshot,
} from "../../../shared/schemas/requirement-change.ts";
import { apiGet, apiPost } from "../../lib/api.ts";
import { t, useLocale } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { Modal } from "../ui/Modal.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { TextArea } from "../ui/TextArea.tsx";
import { StateBlock } from "../ui/StateBlock.tsx";
import { useSettingsDraft } from "../settings/SettingsDraft.tsx";
import { WorkItemTag } from "./WorkItemTag.tsx";
import { ChangeDiff } from "./ChangeDiff.tsx";

const endpoint = (id: string) => `/api/v1/work-items/${id}/changes`;
function Status({ status }: { status: ChangeStatus }) {
  return (
    <WorkItemTag
      kind="status"
      value={
        status === "APPLIED"
          ? "DONE"
          : status === "APPROVED"
            ? "IN_PROGRESS"
            : "NOT_STARTED"
      }
      stateKey={status === "PENDING" ? "PENDING_APPROVAL" : status}
      label={t(`change.status.${status}`)}
    />
  );
}
function ErrorState({ retry }: { retry: () => void }) {
  return (
    <StateBlock
      kind="error"
      title={t("common.loadFailedShort")}
      action={retry}
      actionLabel={t("common.reload")}
    />
  );
}
export function RequirementChanges(props: {
  workItemId: string;
  workItemVersion: number;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  return (
    <details
      className="wi-detail-fold requirement-changes"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>{t("change.section")}</summary>
      {open && <ChangeWorkspace key={props.workItemId} {...props} />}
    </details>
  );
}
function ChangeWorkspace({
  workItemId,
  workItemVersion,
}: {
  workItemId: string;
  workItemVersion: number;
}) {
  const qc = useQueryClient(),
    [selected, setSelected] = useState<string | null>(null),
    [creating, setCreating] = useState(false);
  const list = useInfiniteQuery({
    queryKey: ["requirement-changes", workItemId],
    initialPageParam: undefined as number | undefined,
    retry: false,
    queryFn: ({ pageParam }) =>
      apiGet<RequirementChangePage>(endpoint(workItemId), {
        limit: 20,
        ...(pageParam ? { before: pageParam } : {}),
      }),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const context = useQuery({
    queryKey: ["requirement-change-context", workItemId, workItemVersion],
    retry: false,
    queryFn: () =>
      apiGet<RequirementChangeContext>(endpoint(workItemId) + "/context"),
  });
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["requirement-changes", workItemId] }),
      qc.invalidateQueries({ queryKey: ["requirement-change", workItemId] }),
      qc.invalidateQueries({
        queryKey: ["requirement-change-context", workItemId],
      }),
      qc.invalidateQueries({ queryKey: ["work-item-detail", workItemId] }),
      qc.invalidateQueries({ queryKey: ["requirement-history", workItemId] }),
    ]);
  };
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="requirement-changes__content">
      <div className="requirement-changes__toolbar">
        <p className="muted">{t("change.intro")}</p>
        {context.data?.canCreate && (
          <Button size="sm" onClick={() => setCreating(true)}>
            {t("change.create")}
          </Button>
        )}
      </div>
      {context.isError && !list.isError && (
        <p className="muted">
          {t("change.contextFailed")}{" "}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void context.refetch()}
          >
            {t("common.reload")}
          </Button>
        </p>
      )}
      {list.isError && !list.isFetchNextPageError ? (
        <ErrorState retry={() => void list.refetch()} />
      ) : list.isPending ? (
        <p role="status">{t("common.loading")}</p>
      ) : (
        <>
          {!rows.length && <p className="muted">{t("change.empty")}</p>}
          <ul className="requirement-changes__list">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  aria-pressed={selected === row.id}
                  onClick={() =>
                    setSelected(selected === row.id ? null : row.id)
                  }
                >
                  <span className="requirement-changes__name">
                    <span className="muted">#{row.number}</span>{" "}
                    {row.proposedTitle}
                  </span>
                  <Status status={row.status} />
                  <span className="requirement-changes__reason">
                    {row.reason}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {list.isFetchNextPageError ? (
            <ErrorState retry={() => void list.fetchNextPage()} />
          ) : (
            list.hasNextPage && (
              <Button
                size="sm"
                variant="ghost"
                loading={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {t("change.loadMore")}
              </Button>
            )
          )}
        </>
      )}
      {selected && (
        <ChangeDetail
          key={selected}
          workItemId={workItemId}
          workItemVersion={workItemVersion}
          id={selected}
          refresh={refresh}
        />
      )}
      {creating && context.data && (
        <ChangeForm
          workItemId={workItemId}
          initial={context.data}
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            setSelected(id);
            setCreating(false);
            await refresh();
          }}
        />
      )}
    </div>
  );
}
function ImpactPreview({ impacts }: { impacts: RequirementImpactSnapshot[] }) {
  return (
    <div className="requirement-changes__impacts">
      <h4>{t("change.impacts", { n: impacts.length })}</h4>
      <p className="muted">{t("change.scope")}</p>
      {!impacts.length ? (
        <p className="muted">{t("change.noImpacts")}</p>
      ) : (
        <ul>
          {impacts.map((i) => (
            <li key={i.kind + i.targetId}>
              <span className="tag">{t(`change.kind.${i.kind}`)}</span>
              <span>
                {i.key && <small>{i.key} · </small>}
                {i.title}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
function ChangeForm({
  workItemId,
  initial,
  onClose,
  onCreated,
}: {
  workItemId: string;
  initial: RequirementChangeContext;
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const baseline = useRef(initial).current,
    [title, setTitle] = useState(initial.baseRevision.title),
    [description, setDescription] = useState(
      initial.baseRevision.description ?? "",
    ),
    [reason, setReason] = useState(""),
    [preview, setPreview] = useState(false);
  const saving = useRef(false);
  // 保留null与空串的正文历史区别；未编辑正文时不额外改动原值。
  const body =
    description === (baseline.baseRevision.description ?? "")
      ? baseline.baseRevision.description
      : description;
  const save = useMutation({
    mutationFn: () =>
      apiPost<RequirementChangeDetail>(endpoint(workItemId), {
        title: title.trim(),
        description: body,
        reason: reason.trim(),
        baseRevisionId: baseline.baseRevision.id,
        expectedWorkItemVersion: baseline.workItemVersion,
        impactFingerprint: baseline.impactFingerprint,
      }),
    onSuccess: (r) => onCreated(r.id),
    onSettled: () => {
      saving.current = false;
    },
  });
  const draft = useSettingsDraft(
      true,
      { title, description, reason },
      save.isPending,
    ),
    close = () => void draft.leave(onClose);
  const changed =
    title.trim() !== baseline.baseRevision.title ||
    body !== baseline.baseRevision.description;
  const submit = () => {
    if (!title.trim() || !reason.trim() || !changed || saving.current) return;
    saving.current = true;
    save.mutate();
  };
  return (
    <Modal
      open
      title={t("change.create")}
      onClose={close}
      width="lg"
      footer={
        <>
          <Button disabled={save.isPending} onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!changed || !title.trim() || !reason.trim()}
            onClick={submit}
          >
            {t("change.submit")}
          </Button>
        </>
      }
    >
      {draft.guard}
      <form
        className="requirement-changes__form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="muted">
          {t("change.baseline", { n: baseline.baseRevision.revisionNo })}
        </p>
        <TextInput
          label={t("change.proposedTitle")}
          value={title}
          maxLength={500}
          autoFocus
          disabled={save.isPending}
          onChange={(e) => setTitle(e.target.value)}
        />
        <TextArea
          label={t("change.reason")}
          value={reason}
          maxLength={4000}
          rows={2}
          disabled={save.isPending}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button
          size="sm"
          aria-pressed={preview}
          onClick={() => setPreview(!preview)}
        >
          {t(preview ? "change.editProposal" : "change.preview")}
        </Button>
        {preview ? (
          <>
            <ChangeDiff
              label={t("revision.title")}
              before={baseline.baseRevision.title} after={title}
            />
            <ChangeDiff
              label={t("revision.body")}
              before={baseline.baseRevision.description ?? ""} after={description}
            />
          </>
        ) : (
          <TextArea
            label={t("change.proposedBody")}
            value={description}
            maxLength={20000}
            rows={8}
            disabled={save.isPending}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
        <ImpactPreview impacts={baseline.impacts} />
        {save.isError && (
          <p className="alert alert-error" role="alert">
            {save.error.message}
          </p>
        )}
      </form>
    </Modal>
  );
}
function ChangeDetail({
  workItemId,
  workItemVersion,
  id,
  refresh,
}: {
  workItemId: string;
  workItemVersion: number;
  id: string;
  refresh: () => Promise<void>;
}) {
  const [note, setNote] = useState(""),
    saving = useRef(false);
  const detail = useQuery({
    queryKey: ["requirement-change", workItemId, id, workItemVersion],
    retry: false,
    queryFn: () =>
      apiGet<RequirementChangeDetail>(endpoint(workItemId) + `/${id}`),
  });
  const action = useMutation({
    mutationFn: ({
      path,
      body,
    }: {
      path: string;
      body: Record<string, unknown>;
    }) =>
      apiPost<RequirementChangeDetail>(
        endpoint(workItemId) + `/${id}/${path}`,
        body,
      ),
    onSuccess: async () => {
      setNote("");
      await refresh();
    },
    onSettled: () => {
      saving.current = false;
    },
  });
  if (detail.isError) return <ErrorState retry={() => void detail.refetch()} />;
  if (!detail.data) return <p role="status">{t("common.loading")}</p>;
  const row = detail.data;
  const person = (id: string | null) =>
    row.participants?.find((p) => p.id === id)?.name ??
    t("change.formerMember");
  const run = (path: string, body: Record<string, unknown>) => {
    if (saving.current) return;
    saving.current = true;
    action.mutate({ path, body: { expectedVersion: row.version, ...body } });
  };
  const decide = (decision: string) => run("decide", { decision, note });
  return (
    <section
      className="requirement-changes__detail"
      aria-label={t("change.detail")}
    >
      <div className="requirement-changes__heading">
        <h4>
          #{row.number} {row.proposedTitle}
        </h4>
        <Status status={row.status} />
      </div>
      <p className="requirement-changes__reason-full">{row.reason}</p>
      <p className="muted">
        {t("change.baseline", { n: row.baseRevision.revisionNo })} ·{" "}
        {new Date(row.createdAt).toLocaleString()}
      </p>
      <dl className="requirement-changes__people">
        <div>
          <dt>{t("change.requestedBy")}</dt>
          <dd>{person(row.requestedBy)}</dd>
        </div>
        {row.decidedAt && (
          <div>
            <dt>{t("change.reviewedBy")}</dt>
            <dd>
              {person(row.decidedBy)} ·{" "}
              {new Date(row.decidedAt).toLocaleString()}
            </dd>
          </div>
        )}
        {row.appliedAt && (
          <div>
            <dt>{t("change.appliedBy")}</dt>
            <dd>
              {person(row.appliedBy)} ·{" "}
              {new Date(row.appliedAt).toLocaleString()}
            </dd>
          </div>
        )}
        {row.cancelledAt && (
          <div>
            <dt>{t("change.cancelledBy")}</dt>
            <dd>
              {person(row.cancelledBy)} ·{" "}
              {new Date(row.cancelledAt).toLocaleString()}
            </dd>
          </div>
        )}
      </dl>
      {row.stale && (
        <p className="alert alert-warning" role="status">
          {t("change.stale")}
        </p>
      )}
      <ChangeDiff
        label={t("revision.title")}
        before={row.baseRevision.title} after={row.proposedTitle}
      />
      <ChangeDiff
        label={t("revision.body")}
        before={row.baseRevision.description ?? ""} after={row.proposedDescription ?? ""}
      />
      {row.reviewNote && (
        <p>
          {t("change.reviewNote")}: {row.reviewNote}
        </p>
      )}
      {row.cancelNote && (
        <p>
          {t("change.cancelNote")}: {row.cancelNote}
        </p>
      )}
      {(row.canReview ||
        row.canCancel ||
        row.impacts.some((i) => i.canAcknowledge)) && (
        <TextArea
          label={t("change.note")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={4000}
          rows={2}
          disabled={action.isPending}
        />
      )}
      {row.canApply && <p className="muted">{t("change.applyHint")}</p>}
      {(row.canReview||row.canApply||row.canCancel)&&<div className="requirement-changes__actions">
        {row.canReview && (
          <>
            <Button
              size="sm"
              disabled={action.isPending || row.stale}
              onClick={() => decide("APPROVE")}
            >
              {t("change.approve")}
            </Button>
            <Button
              size="sm"
              disabled={action.isPending}
              onClick={() => decide("REJECT")}
            >
              {t("change.reject")}
            </Button>
          </>
        )}
        {row.canApply && (
          <Button
            size="sm"
            variant="primary"
            disabled={action.isPending}
            onClick={() =>
              run("apply", { expectedWorkItemVersion: workItemVersion })
            }
          >
            {t("change.apply")}
          </Button>
        )}
        {row.canCancel && (
          <Button
            size="sm"
            variant="ghost"
            disabled={action.isPending}
            onClick={() => decide("CANCEL")}
          >
            {t("change.cancel")}
          </Button>
        )}
      </div>}
      <div className="requirement-changes__impacts">
        <h4>{t("change.impacts", { n: row.impacts.length })}</h4>
        <p className="muted">{t("change.scope")}</p>
        {!row.impacts.length && (
          <p className="muted">{t("change.noImpacts")}</p>
        )}
        <ul>
          {row.impacts.map((i) => (
            <li key={i.id}>
              <div>
                <span className="tag">{t(`change.kind.${i.kind}`)}</span>{" "}
                <span>
                  {i.key && <small>{i.key} · </small>}
                  {i.title}
                </span>
                {i.acknowledgedAt && (
                  <p className="muted">
                    {person(i.acknowledgedBy)} ·{" "}
                    {new Date(i.acknowledgedAt).toLocaleString()}
                  </p>
                )}
                {i.note && <p className="muted">{i.note}</p>}
              </div>
              <WorkItemTag
                kind="status"
                value={i.acknowledgedAt ? "DONE" : "NOT_STARTED"}
                stateKey={
                  i.acknowledgedAt
                    ? "ACKNOWLEDGED"
                    : i.available === false
                      ? "UNAVAILABLE"
                      : "WAIT_CONFIRMATION"
                }
                label={t(
                  i.acknowledgedAt
                    ? "change.acknowledged"
                    : i.available === false
                      ? "change.unavailable"
                      : "change.pendingAcknowledgement",
                )}
              />
              {i.canAcknowledge && (
                <Button
                  size="sm"
                  disabled={action.isPending}
                  onClick={() => run("acknowledge", { impactId: i.id, note })}
                >
                  {t("change.acknowledge")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
      {action.isError && (
        <p className="alert alert-error" role="alert">
          {action.error.message}
        </p>
      )}
    </section>
  );
}
