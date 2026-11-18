/** 顶栏账户菜单里的修改密码弹窗；成功后服务端吊销会话，回到登录页。 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { apiPost, ApiError } from "../lib/api.ts";
import { t } from "../i18n/index.ts";
import { Button } from "./ui/Button.tsx";
import { Modal } from "./ui/Modal.tsx";
import { TextInput } from "./ui/TextInput.tsx";
import { toast } from "./ui/Toast.tsx";

export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = newPassword.length >= 12 && newPassword === confirm;

  const close = () => {
    if (busy) return;
    setCurrent(""); setNew(""); setConfirm(""); setError(null);
    onClose();
  };
  const submit = async () => {
    if (!valid) return;
    setBusy(true); setError(null);
    try {
      await apiPost("/api/v1/auth/password/change", { currentPassword, newPassword });
      toast.success(t("pwd.changed"));
      setCurrent(""); setNew(""); setConfirm("");
      onClose();
      void navigate({ to: "/login" });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("pwd.failed"));
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title={t("pwd.title")} onClose={close} width="sm"
      footer={<>
        <Button onClick={close} disabled={busy}>{t("common.cancel")}</Button>
        <Button variant="primary" loading={busy} disabled={!valid || busy} onClick={() => void submit()}>{t("pwd.submit")}</Button>
      </>}>
      <div className="change-password-form">
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <TextInput label={t("pwd.current")} type="password" autoComplete="current-password"
          value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
        <TextInput label={t("pwd.new")} type="password" autoComplete="new-password"
          value={newPassword} onChange={(e) => setNew(e.target.value)} hint={t("pwd.minHint")} />
        <TextInput label={t("pwd.confirm")} type="password" autoComplete="new-password"
          value={confirm} onChange={(e) => setConfirm(e.target.value)}
          error={confirm && newPassword !== confirm ? t("pwd.mismatch") : undefined} />
        <p className="muted change-password-note">{t("pw.reloginHint")}</p>
      </div>
    </Modal>
  );
}
