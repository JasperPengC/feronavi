import { lazy, Suspense, useEffect, useState } from "react";
import { t, useLocale } from "../../i18n/index.ts";
import { Drawer } from "../ui/Drawer.tsx";

const Detail = lazy(() => import("./WorkItemDrawer.tsx").then(module => ({ default: module.WorkItemDrawer })));

/** 列表与通知只在首次打开详情时下载编辑器；随后保留挂载，交由 Drawer 完成退场与焦点恢复。 */
export function WorkItemDrawer(props: { workItemId: string | null; onClose: () => void }) {
  useLocale();
  const [hasOpened, setHasOpened] = useState(!!props.workItemId);
  useEffect(() => { if (props.workItemId) setHasOpened(true); }, [props.workItemId]);
  if (!props.workItemId && !hasOpened) return null;
  return <Suspense fallback={<Drawer open={!!props.workItemId} title={t("wiDetail.title")}
    onClose={props.onClose} width="lg" className="work-item-detail">
    <p className="muted">{t("common.loading")}</p>
  </Drawer>}><Detail {...props} /></Suspense>;
}
