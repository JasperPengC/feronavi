import { useId, useState } from "react";
import { t, useLocale } from "../../i18n/index.ts";
import { Icon } from "../Icon.tsx";
import { Button } from "../ui/Button.tsx";

export interface SetupDatabaseInfo {
  ok: boolean;
  current?: boolean;
  host?: string;
  database?: string;
  user?: string;
  maskedUrl?: string;
  version?: string;
  major?: number;
  compatible?: boolean;
  recommended?: boolean;
  error?: string;
  extensions?: { vector: boolean; zhparser: boolean; pgTrgm: boolean };
}

export function SetupDatabaseSummary({ info }: { info: SetupDatabaseInfo }) {
  useLocale();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const version = info.version?.match(/^PostgreSQL\s+[\d.]+/u)?.[0] || "PostgreSQL";
  const extensions = [
    { name: "pgvector", available: info.extensions?.vector },
    { name: "zhparser", available: info.extensions?.zhparser },
    { name: "pg_trgm", available: info.extensions?.pgTrgm },
  ];

  return (
    <section className="setup-db-summary" aria-label={t("su.dbCurrent")}>
      <header className="setup-db-summary-head">
        <h2>{t("su.dbCurrent")}</h2>
        <span className="setup-db-version" title={info.version}>{version}</span>
        {info.maskedUrl && (
          <Button className="setup-db-detail-toggle" variant="ghost" iconOnly
            title={t(expanded ? "su.dbHideConnection" : "su.dbShowConnection")}
            aria-label={t(expanded ? "su.dbHideConnection" : "su.dbShowConnection")}
            aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(!expanded)}>
            <Icon name="chevron-down" size={14} style={expanded ? { transform: "rotate(180deg)" } : undefined} />
          </Button>
        )}
      </header>
      <dl className="setup-db-summary-facts">
        {[
          [t("su.dbHostLabel"), info.host],
          [t("su.dbName"), info.database],
          [t("su.dbUserLabel"), info.user],
        ].map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd><code title={value}>{value || "—"}</code></dd></div>
        ))}
      </dl>
      <div id={detailsId} className="setup-db-connection" data-expanded={expanded} aria-hidden={!expanded} inert={!expanded}>
        <div className="setup-db-connection-body">
          <span className="setup-db-connection-label">{t("su.dbPreview")}</span>
          <code dir="ltr">{info.maskedUrl}</code>
        </div>
      </div>
      <div className="setup-db-summary-extensions">
        <span>{t("su.dbExtensions")}</span>
        <ul>
          {extensions.map(({ name, available }) => (
            <li key={name} data-state={available === true ? "ready" : available === false ? "missing" : "unknown"}>
              <Icon name={available === true ? "check" : available === false ? "x" : "info"} size={14} />
              <span>{name}</span>
              <span className={available === true ? "sr-only" : "setup-db-extension-status"}>
                {t(available === true ? "su.dbExtensionReady" : available === false ? "su.dbExtensionMissing" : "su.dbExtensionUnknown")}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="setup-db-summary-requirement">{t("su.dbVersionRecommendation")}</p>
      {info.compatible === false && <p className="field-error setup-db-summary-warning" role="alert">{t("su.dbVersionBad")}</p>}
      {info.extensions?.vector === false && <p className="setup-db-summary-warning">{t("su.dbVectorImpact")}</p>}
      {info.extensions?.zhparser === false && <p className="setup-db-summary-warning">{t("su.dbZhparserImpact")}</p>}
    </section>
  );
}
