/**
 * 平台更新日志（What's New）。
 *
 * 概念澄清（用户指出）：平台菜单下的「更新日志」记录 **Feronavi 产品自身**的版本；
 * 各项目的发布说明属于项目数据，在项目 → 里程碑 → 版本中维护，不能混到平台更新里。
 */
import { useEffect } from "react";
import { t, useLocale } from "../i18n/index.ts";
import { PageHead } from "../components/Page.tsx";
import { PLATFORM_CHANGELOG } from "../../shared/platform-changelog.ts";
import { Icon } from "../components/Icon.tsx";

export function ChangelogPage() {
  useLocale();
  const entries = PLATFORM_CHANGELOG;
  // 页面内容可能超过视口，主滚动区必须可键盘聚焦（axe scrollable-region-focusable）
  useEffect(() => {
    const main = document.getElementById("main-content");
    if (!main) return;
    const previous = main.getAttribute("tabindex");
    main.setAttribute("tabindex", "0");
    return () => {
      if (previous === null) main.removeAttribute("tabindex");
      else main.setAttribute("tabindex", previous);
    };
  }, []);
  return (
    <div className="page collection-page changelog-page">
      <PageHead title={t("cl.platformTitle")} />
      <div className="cl-platform-note" role="note">
        <Icon name="info" size={14} />
        <span>{t("cl.platformNote")}</span>
      </div>
      <div className="changelog-timeline">
        {entries.map((e) => (
          <article className="cl-item changelog-entry" key={`${e.version}-${e.date}`}>
            <time className="cl-date" dateTime={e.date}>{e.date}</time>
            <div className="cl-rail" aria-hidden="true"><span className="cl-dot" /></div>
            <div className="cl-card">
              <div className="cl-head">
                <span className="cl-version mono">{e.version}</span>
                <span className={`tag cl-kind cl-kind--${e.kind}`}>{t(`cl.kind.${e.kind}`)}</span>
                <strong className="cl-name">{e.title}</strong>
              </div>
              <p className="changelog-notes">{e.summary}</p>
              <ul className="cl-highlights">
                {e.highlights.map((h) => <li key={h}>{h}</li>)}
              </ul>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
