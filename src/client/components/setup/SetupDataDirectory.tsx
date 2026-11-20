import { useId, useState } from "react";
import { t, useLocale } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../Icon.tsx";

export function SetupDataDirectory({ path, ok }: { path: string; ok: boolean }) {
  useLocale();
  const fullPathId = useId();
  const [expanded, setExpanded] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const split = separator > 0 ? separator : Math.floor(path.length / 2);

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(path);
      setCopyState("copied");
    } catch {
      setExpanded(true);
      setCopyState("failed");
    }
  }

  return (
    <div className="setup-directory">
      <div className="setup-directory-heading">
        <span>{t("su.dataDirectory")}</span>
        <span>{t(ok ? "su.directoryWritable" : "su.directoryNotWritable")}</span>
      </div>
      <div className="setup-directory-path">
        <code className="setup-directory-preview" dir="ltr" title={path}>
          <span className="setup-directory-prefix">{path.slice(0, split)}</span>
          <span className="setup-directory-tail"><span>{path.slice(split)}</span></span>
        </code>
        <Button variant="ghost" iconOnly aria-label={t("su.copyPath")} title={t(copyState === "copied" ? "common.copyDone" : "su.copyPath")} onClick={() => void copyPath()}>
          <Icon name={copyState === "copied" ? "check" : "copy"} size={15} />
        </Button>
        <Button variant="ghost" iconOnly aria-label={t(expanded ? "su.hideFullPath" : "su.showFullPath")} title={t(expanded ? "su.hideFullPath" : "su.showFullPath")} aria-expanded={expanded} aria-controls={fullPathId} onClick={() => setExpanded(!expanded)}>
          <Icon name="chevron-down" size={14} style={expanded ? { transform: "rotate(180deg)" } : undefined} />
        </Button>
      </div>
      <span className={copyState === "failed" ? "setup-directory-feedback" : "sr-only"} role="status">{copyState === "copied" ? t("common.copyDone") : copyState === "failed" ? t("common.copyFailed") : ""}</span>
      <div id={fullPathId} className="setup-directory-details" data-expanded={expanded} aria-hidden={!expanded} inert={!expanded}>
        <div className="setup-directory-details-body">
          <code className="setup-directory-full" dir="ltr">{path}</code>
          <p className="setup-directory-hint">{t("su.directoryDeploymentHint")}</p>
        </div>
      </div>
    </div>
  );
}
