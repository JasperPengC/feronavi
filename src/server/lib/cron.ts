import { CronExpressionParser } from "cron-parser";
/** cron 是否落在最近一分钟窗口内；尊重 IANA 时区。 */
export function cronDue(expr: string, timezone: string, now = new Date()): boolean {
  try {
    const interval = CronExpressionParser.parse(expr, { tz: timezone || "Asia/Shanghai", currentDate: new Date(now.getTime() - 60_000) });
    const next = interval.next().toDate();
    return next.getTime() <= now.getTime() && now.getTime() - next.getTime() < 90_000;
  } catch { return false; }
}
