/** 信息提示：小 info 图标 + 可点击/悬停/聚焦的提示气泡，替代页面里大段解释性副标题。 */
import { Icon } from "../Icon.tsx";
import { t } from "../../i18n/index.ts";
import { Tooltip } from "./Tooltip.tsx";

export function InfoTip({ text, label = t("common.info") }: { text: string; label?: string }) {
  return (
    <Tooltip content={text}>
      {(trigger) =>
      <button
        {...trigger}
        type="button"
        className="info-tip-trigger"
        aria-label={label}
      >
        <Icon name="info" size={13} />
      </button>
      }
    </Tooltip>
  );
}
