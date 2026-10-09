const DAY_MS = 86_400_000;

export function parseLocalDate(value?: string) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) || parsed.getFullYear()!==year || parsed.getMonth()!==month-1 || parsed.getDate()!==day ? null : parsed;
}

export function utcCalendarDay(value: Date) {
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
}

export function calendarDayDiff(from: Date, to: Date) {
  return Math.floor((utcCalendarDay(to) - utcCalendarDay(from)) / DAY_MS);
}

export function daysSince(date?: string, now = new Date()) {
  const start = parseLocalDate(date);
  return start ? Math.max(0, calendarDayDiff(start, now)) : null;
}

export function relationshipBreakdown(date?: string, now = new Date()) {
  const start = parseLocalDate(date);
  if (!start) return null;

  const cursor = new Date(start);
  let years = 0;
  while (true) {
    const next = new Date(cursor);
    next.setFullYear(next.getFullYear() + 1);
    if (next > now) break;
    cursor.setTime(next.getTime());
    years += 1;
  }

  let months = 0;
  while (true) {
    const next = new Date(cursor);
    next.setMonth(next.getMonth() + 1);
    if (next > now) break;
    cursor.setTime(next.getTime());
    months += 1;
  }

  return { years, months, days: Math.max(0, calendarDayDiff(cursor, now)) };
}

export function nextAnniversary(date?: string, now = new Date()) {
  const start = parseLocalDate(date);
  if (!start) return null;

  const inYear=(year:number)=>new Date(year,start.getMonth(),Math.min(start.getDate(),new Date(year,start.getMonth()+1,0).getDate()));
  let target = inYear(now.getFullYear());
  if (utcCalendarDay(target) < utcCalendarDay(now)) {
    target = inYear(now.getFullYear() + 1);
  }

  return {
    target,
    days: Math.max(0, calendarDayDiff(now, target)),
    years: target.getFullYear() - start.getFullYear(),
  };
}

export function formatDateOnly(value?: string, locale?: string) {
  const date = parseLocalDate(value);
  return date
    ? date.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })
    : "Set your first meeting date";
}

export function dayKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function dayLabel(value: string, now = new Date(), locale?: string) {
  const date = new Date(value);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const arabic = locale?.startsWith("ar");
  if (dayKey(date) === dayKey(now)) return arabic ? "اليوم" : "Today";
  if (dayKey(date) === dayKey(yesterday)) return arabic ? "أمس" : "Yesterday";
  return date.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
}
