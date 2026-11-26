import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { TestSuite } from "../../../shared/schemas/test-management.ts";
import { apiPatch, apiPost } from "../../lib/api.ts";
import { t } from "../../i18n/index.ts";
import { Modal } from "../ui/Modal.tsx";
import { TextInput } from "../ui/TextInput.tsx";
import { TextArea } from "../ui/TextArea.tsx";
import { Button } from "../ui/Button.tsx";
import { useSettingsDraft } from "../settings/SettingsDraft.tsx";
import { testingEndpoint } from "./testing-ui.tsx";
export function TestSuiteEditor({
  projectId,
  row,
  onClose,
  onSaved,
}: {
  projectId: string;
  row: TestSuite | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(row?.name ?? ""),
    [description, setDescription] = useState(row?.description ?? ""),
    saving = useRef(false);
  const save = useMutation({
    mutationFn: () =>
      row
        ? apiPatch(testingEndpoint(projectId) + `/suites/${row.id}`, {
            name,
            description,
            expectedVersion: row.version,
          })
        : apiPost(testingEndpoint(projectId) + "/suites", {
            name,
            description,
          }),
    onSuccess: async () => {
      await onSaved();
      onClose();
    },
    onSettled: () => {
      saving.current = false;
    },
  });
  const draft = useSettingsDraft(true, { name, description }, save.isPending),
    close = () => void draft.leave(onClose);
  const submit = () => {
    if (!name.trim() || saving.current) return;
    saving.current = true;
    save.mutate();
  };
  return (
    <Modal
      open
      title={t(row ? "testing.editSuite" : "testing.newSuite")}
      width="sm"
      onClose={close}
      footer={
        <>
          <Button disabled={save.isPending} onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!name.trim()}
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
        <TextInput
          label={t("testing.suiteName")}
          autoFocus
          value={name}
          maxLength={120}
          disabled={save.isPending}
          onChange={(e) => setName(e.target.value)}
        />
        <TextArea
          label={t("common.description")}
          value={description}
          maxLength={4000}
          rows={3}
          disabled={save.isPending}
          onChange={(e) => setDescription(e.target.value)}
        />
        {save.isError && (
          <p className="alert alert-error" role="alert">
            {save.error.message}
          </p>
        )}
      </form>
    </Modal>
  );
}
