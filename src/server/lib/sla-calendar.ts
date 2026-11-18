/** SLA 工作时间日历：仅按每周工作时段顺延；法定节假日不在本版范围。 */
export interface BusinessCalendar {
  enabled?: boolean;
  days?: number[];
  start?: string;
  end?: string;
  /** 法定节假日，YYYY-MM-DD（本地时区） */
  holidays?: string[];
  /** 调休上班日，YYYY-MM-DD（周末也按工作日） */
  extraWorkdays?: string[];
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addSlaMinutes(start: Date, amount: number, calendar?: BusinessCalendar | null): Date {
  if (!calendar?.enabled) return new Date(start.getTime() + amount * 60_000);
  const days = (calendar.days?.length ? calendar.days : [1, 2, 3, 4, 5]).filter((d) => d >= 0 && d <= 6);
  const [sh0, sm0] = (calendar.start ?? "09:00").split(":").map(Number);
  const [eh0, em0] = (calendar.end ?? "18:00").split(":").map(Number);
  const sh = sh0 ?? 9, sm = sm0 ?? 0, eh = eh0 ?? 18, em = em0 ?? 0;
  if (!Number.isFinite(sh) || !Number.isFinite(eh) || eh * 60 + em <= sh * 60 + sm) {
    return new Date(start.getTime() + amount * 60_000);
  }
  const holidays = new Set(calendar.holidays ?? []);
  const extraWorkdays = new Set(calendar.extraWorkdays ?? []);
  const isWorkday = (date: Date) => {
    const key = dateKey(date);
    if (extraWorkdays.has(key)) return true;
    if (holidays.has(key)) return false;
    return days.includes(date.getDay());
  };
  const d = new Date(start);
  let remaining = amount;
  let guard = 0;
  while (remaining > 0 && guard++ < 100_000) {
    if (!isWorkday(d)) {
      d.setDate(d.getDate() + 1); d.setHours(sh, sm, 0, 0); continue;
    }
    const dayStart = new Date(d); dayStart.setHours(sh, sm, 0, 0);
    const dayEnd = new Date(d); dayEnd.setHours(eh, em, 0, 0);
    if (d < dayStart) d.setTime(dayStart.getTime());
    if (d >= dayEnd) { d.setDate(d.getDate() + 1); d.setHours(sh, sm, 0, 0); continue; }
    const available = (dayEnd.getTime() - d.getTime()) / 60_000;
    if (remaining <= available) { d.setTime(d.getTime() + remaining * 60_000); remaining = 0; }
    else { remaining -= available; d.setDate(d.getDate() + 1); d.setHours(sh, sm, 0, 0); }
  }
  return d;
}
