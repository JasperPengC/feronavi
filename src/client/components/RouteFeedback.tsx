import { LoadingBlock, StateBlock } from "./ui/StateBlock.tsx";
import { t, useLocale } from "../i18n/index.ts";

export function RoutePending() {
  useLocale();
  return <LoadingBlock />;
}

/** 新部署替换了模块地址或网络失败时，重新加载可取得当前版本入口。 */
export function RouteLoadError() {
  useLocale();
  return <StateBlock kind="error" title={t("common.loadFailedShort")} description={t("eb.desc")}
    action={() => window.location.reload()} actionLabel={t("common.reload")} />;
}
