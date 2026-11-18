/** 全站分页：固定在主体内容区底部；只滚内容，不把分页推走。 */
import { t } from "../../i18n/index.ts";
import { Button } from "./Button.tsx";
import { Icon } from "../Icon.tsx";

export function PagePagination({ page, pages, total, onPage, showSingle = false }: {
  page: number;
  pages: number;
  total?: number;
  onPage: (page: number) => void;
  showSingle?: boolean;
}) {
  if (pages <= 1 && !showSingle) return null;
  return (
    <nav className="page-pagination" aria-label={t("common.pagination")}>
      <span className="page-pagination-total muted">
        {total !== undefined ? t("common.totalItems", { n: String(total) }) : ""}
      </span>
      <span className="page-pagination-status muted">{t("common.pageOf", { page: String(page), pages: String(pages) })}</span>
      <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <Icon name="chevron-left" size={14} />{t("common.prevPage")}
      </Button>
      <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t("common.nextPage")}<Icon name="chevron-right" size={14} />
      </Button>
    </nav>
  );
}
