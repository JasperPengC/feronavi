import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  TestCaseDetail,
  TestSuite,
  TestRequirementRef,
  TestStep,
} from "../../../shared/schemas/test-management.ts";
import { apiGet, apiPatch, apiPost } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { Drawer } from "../ui/Drawer.tsx";
import { Button } from "../ui/Button.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { TextArea } from "../ui/TextArea.tsx";
import { Select } from "../Select.tsx";
import { StateBlock } from "../ui/StateBlock.tsx";
import { useSettingsDraft } from "../settings/SettingsDraft.tsx";
import { testingEndpoint, testingKey } from "./testing-ui.tsx";

export function TestCaseEditor({
  projectId,
  row,
  onClose,
  onSaved,
}: {
  projectId: string;
  row: TestCaseDetail | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState(row?.title ?? ""),
    [preconditions, setPreconditions] = useState(
      row?.revision.preconditions ?? "",
    );
  const [steps, setSteps] = useState<TestStep[]>(row?.revision.steps ?? []),
    [requirements, setRequirements] = useState<TestRequirementRef[]>(
      row?.revision.requirements ?? [],
    );
  const [priority, setPriority] = useState(row?.priority ?? "MEDIUM"),
    [status, setStatus] = useState(row?.status ?? "DRAFT"),
    [suiteId, setSuiteId] = useState(row?.suiteId ?? ""),
    [ownerId, setOwnerId] = useState(row?.ownerId ?? "");
  const [ownerChanged, setOwnerChanged] = useState(false),
    saving = useRef(false);
  const [linking, setLinking] = useState(false);
  const linkBusy = useRef(false);
  const setLinkingState = (pending: boolean) => {
    linkBusy.current = pending;
    setLinking(pending);
  };
  const suites = useQuery({
    queryKey: [...testingKey(projectId), "suites"],
    queryFn: () =>
      apiGet<{ items: TestSuite[] }>(testingEndpoint(projectId) + "/suites"),
    retry: false,
  });
  const members = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () =>
      apiGet<{ members: { id: string; name: string }[] }>(
        `/api/v1/projects/${projectId}/members`,
      ).then((r) => r.members ?? []),
    retry: false,
  });
  const form = {
    title,
    preconditions,
    steps,
    requirements,
    priority,
    status,
    suiteId,
    ownerId,
  };
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: title.trim(),
        preconditions,
        steps,
        requirements: requirements.map((r) => ({
          workItemId: r.workItemId,
          revisionId: r.revisionId,
        })),
        priority,
        status,
        suiteId: suiteId || null,
        ...(row || ownerChanged ? { ownerId: ownerId || null } : {}),
      };
      return row
        ? apiPatch(testingEndpoint(projectId) + `/cases/${row.id}`, {
            ...body,
            expectedVersion: row.version,
          })
        : apiPost(testingEndpoint(projectId) + "/cases", body);
    },
    onSuccess: async () => {
      await onSaved();
      onClose();
    },
    onSettled: () => {
      saving.current = false;
    },
  });
  const draft = useSettingsDraft(true, form, save.isPending),
    close = () => void draft.leave(onClose);
  const valid =
    !linking &&
    !!title.trim() &&
    steps.every((s) => s.action.trim() && s.expected.trim()) &&
    (status !== "READY" || steps.length > 0);
  const submit = () => {
    if (!valid || saving.current || linkBusy.current) return;
    saving.current = true;
    save.mutate();
  };
  const changeStep = (index: number, patch: Partial<TestStep>) =>
    setSteps(
      steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    );
  return (
    <Drawer
      open
      title={t(row ? "testing.editCase" : "testing.newCase")}
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
            disabled={!valid}
            onClick={submit}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      {draft.guard}
      <form
        className="testing-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {row && (
          <p className="muted testing-baseline">
            <span className="mono">{row.key}</span> ·{" "}
            {t("testing.revision", { n: row.revisionNo })} ·{" "}
            {t("testing.noChange")}
          </p>
        )}
        <TextInput
          label={t("testing.title")}
          value={title}
          autoFocus
          maxLength={300}
          disabled={save.isPending}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="testing-form-grid">
          <Select
            label={t("testing.status")}
            ariaLabel={t("testing.status")}
            value={status}
            onChange={(v) => setStatus(v as typeof status)}
            disabled={save.isPending}
            options={["DRAFT", "READY"].map((value) => ({
              value,
              label: t(`testing.state.${value}`),
            }))}
          />
          <Select
            label={t("testing.priority")}
            ariaLabel={t("testing.priority")}
            value={priority}
            onChange={(v) => setPriority(v as typeof priority)}
            disabled={save.isPending}
            options={["URGENT", "HIGH", "MEDIUM", "LOW", "LOWEST"].map(
              (value) => ({ value, label: t(`prio.${value}`) }),
            )}
          />
          <Select
            label={t("testing.suite")}
            ariaLabel={t("testing.suite")}
            value={suiteId}
            onChange={setSuiteId}
            disabled={save.isPending || suites.isPending || suites.isError}
            searchable
            options={[
              { value: "", label: t("testing.noSuite") },
              ...(suites.data?.items ?? []).map((s) => ({
                value: s.id,
                label: s.name,
              })),
            ]}
          />
          <Select
            label={t("testing.owner")}
            ariaLabel={t("testing.owner")}
            value={ownerId}
            onChange={(v) => {
              setOwnerId(v);
              setOwnerChanged(true);
            }}
            disabled={save.isPending || members.isPending || members.isError}
            searchable
            options={[
              {
                value: "",
                label:
                  !row && !ownerChanged
                    ? t("testing.me")
                    : t("testing.unassigned"),
              },
              ...(members.data ?? []).map((m) => ({
                value: m.id,
                label: m.name,
              })),
              ...(row?.ownerId &&
              !(members.data ?? []).some((m) => m.id === row.ownerId)
                ? [{ value: row.ownerId, label: row.ownerName ?? row.ownerId }]
                : []),
            ]}
          />
        </div>
        {(suites.isError || members.isError) && (
          <StateBlock
            kind="error"
            title={t("common.loadFailedShort")}
            action={() => {
              void suites.refetch();
              void members.refetch();
            }}
            actionLabel={t("common.reload")}
          />
        )}
        <TextArea
          label={t("testing.preconditions")}
          value={preconditions}
          rows={2}
          maxLength={10000}
          disabled={save.isPending}
          onChange={(e) => setPreconditions(e.target.value)}
        />
        <section className="testing-section">
          <div className="testing-section-heading">
            <h3>{t("testing.steps")}</h3>
            <Button
              size="sm"
              disabled={save.isPending || steps.length >= 100}
              onClick={() => setSteps([...steps, { action: "", expected: "" }])}
            >
              {t("testing.addStep")}
            </Button>
          </div>
          {!steps.length && <p className="muted">{t("testing.readyHint")}</p>}
          <ol className="testing-step-editor">
            {steps.map((step, index) => (
              <li key={index}>
                <div className="testing-step-number">
                  <strong>{index + 1}</strong>
                  <div>
                    {index > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={save.isPending}
                        aria-label={t("testing.moveUp", { n: index + 1 })}
                        onClick={() => {
                          const next = [...steps];
                          [next[index - 1], next[index]] = [
                            next[index]!,
                            next[index - 1]!,
                          ];
                          setSteps(next);
                        }}
                      >
                        {t("testing.up")}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={save.isPending}
                      aria-label={t("testing.removeStep", { n: index + 1 })}
                      onClick={() =>
                        setSteps(steps.filter((_, i) => i !== index))
                      }
                    >
                      {t("common.remove")}
                    </Button>
                  </div>
                </div>
                <div className="testing-step-fields">
                  <TextArea
                    label={t("testing.action", { n: index + 1 })}
                    rows={2}
                    value={step.action}
                    maxLength={4000}
                    disabled={save.isPending}
                    onChange={(e) =>
                      changeStep(index, { action: e.target.value })
                    }
                  />
                  <TextArea
                    label={t("testing.expected", { n: index + 1 })}
                    rows={2}
                    value={step.expected}
                    maxLength={4000}
                    disabled={save.isPending}
                    onChange={(e) =>
                      changeStep(index, { expected: e.target.value })
                    }
                  />
                </div>
              </li>
            ))}
          </ol>
        </section>
        <RequirementPicker
          projectId={projectId}
          value={requirements}
          onChange={setRequirements}
          onPendingChange={setLinkingState}
          disabled={save.isPending}
        />
        {save.isError && (
          <p role="alert" className="alert alert-error">
            {save.error.message}
          </p>
        )}
      </form>
    </Drawer>
  );
}
function RequirementPicker({
  projectId,
  value,
  onChange,
  onPendingChange,
  disabled,
}: {
  projectId: string;
  value: TestRequirementRef[];
  onChange: (r: TestRequirementRef[]) => void;
  onPendingChange: (pending: boolean) => void;
  disabled: boolean;
}) {
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const options = useQuery({
    queryKey: [...testingKey(projectId), "requirement-options", query],
    queryFn: () =>
      apiGet<{ rows: { id: string; key: string; title: string }[] }>(
        `/api/v1/projects/${projectId}/work-items`,
        { view: "table", type: "REQUIREMENT", pageSize: 30, q: query },
      ),
    retry: false,
  });
  const add = useMutation({
    mutationFn: async (id: string) => {
      const result = await apiGet<{
        items: { id: string; revisionNo: number; title: string }[];
      }>(`/api/v1/work-items/${id}/revisions`, { limit: 1 });
      const revision = result.items[0],
        item = options.data?.rows.find((r) => r.id === id);
      if (!revision || !item) throw new Error(t("common.loadFailedShort"));
      return {
        workItemId: id,
        revisionId: revision.id,
        key: item.key,
        title: revision.title,
        revisionNo: revision.revisionNo,
      };
    },
    onSuccess: (ref) =>
      onChange([...value.filter((r) => r.workItemId !== ref.workItemId), ref]),
    onSettled: () => onPendingChange(false),
  });
  return (
    <section className="testing-section">
      <h3>{t("testing.requirements")}</h3>
      <p className="muted testing-baseline">{t("testing.baselineHint")}</p>
      <div className="testing-requirement-search">
        <TextInput
          aria-label={t("testing.requirementSearch")}
          placeholder={t("testing.requirementSearch")}
          value={search}
          disabled={disabled}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setQuery(search.trim());
            }
          }}
        />
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => setQuery(search.trim())}
        >
          {t("common.search")}
        </Button>
      </div>
      <Select
        ariaLabel={t("testing.addRequirement")}
        value=""
        disabled={
          disabled ||
          add.isPending ||
          value.length >= 20 ||
          options.isPending ||
          options.isError
        }
        onChange={(id) => {
          if (id) {
            onPendingChange(true);
            add.mutate(id);
          }
        }}
        options={[
          { value: "", label: t("testing.addRequirement") },
          ...(options.data?.rows ?? [])
            .filter((r) => !value.some((v) => v.workItemId === r.id))
            .map((r) => ({ value: r.id, label: `${r.key} · ${r.title}` })),
        ]}
      />
      {options.isError && (
        <StateBlock
          kind="error"
          title={t("common.loadFailedShort")}
          action={() => void options.refetch()}
          actionLabel={t("common.reload")}
        />
      )}
      <ul className="testing-requirements">
        {value.map((ref) => (
          <li key={ref.workItemId}>
            <span>
              <span className="mono">{ref.key}</span> · V{ref.revisionNo} ·{" "}
              {ref.title}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled || add.isPending}
              aria-label={t("testing.unlinkRequirement", { key: ref.key })}
              onClick={() =>
                onChange(value.filter((r) => r.workItemId !== ref.workItemId))
              }
            >
              {t("common.remove")}
            </Button>
          </li>
        ))}
      </ul>
      {add.isError && (
        <p className="alert alert-error" role="alert">
          {add.error.message}
        </p>
      )}
    </section>
  );
}
