/** A month as YYYY-MM, as used in the calendar's ?month= parameter. */
export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const DAY_MS = 24 * 60 * 60_000;

/** The calendar day (YYYY-MM-DD) an instant falls on in a time zone. */
export function getDayKey(date: Date, timeZone: string) {
  // en-CA writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(date);
}

/** Midnight UTC of a YYYY-MM-DD day: calendar days are counted in UTC so they never shift. */
function utcDay(key: string) {
  return new Date(`${key}T00:00:00Z`);
}

/** The weeks shown for a month, Monday first, each day as YYYY-MM-DD (days of the months around it included). */
export function getMonthGrid(month: string): string[][] {
  const first = utcDay(`${month}-01`);
  const next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
  const daysInMonth = Math.round((next.getTime() - first.getTime()) / DAY_MS);
  // getUTCDay() counts from Sunday; the week here starts on Monday.
  const lead = (first.getUTCDay() + 6) % 7;
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
  const start = first.getTime() - lead * DAY_MS;
  const days = Array.from({ length: cells }, (_, i) => new Date(start + i * DAY_MS).toISOString().slice(0, 10));
  return Array.from({ length: cells / 7 }, (_, w) => days.slice(w * 7, w * 7 + 7));
}

/** The month `delta` months before or after `month`. */
export function shiftMonth(month: string, delta: number) {
  const first = utcDay(`${month}-01`);
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + delta, 1)).toISOString().slice(0, 7);
}

/** "tháng 10 năm 2026" / "October 2026" in the interface language. */
export function getMonthLabel(month: string, dateLocale: string) {
  return new Intl.DateTimeFormat(dateLocale, { month: "long", year: "numeric", timeZone: "UTC" }).format(utcDay(`${month}-01`));
}

/** Short weekday names for a grid row, Monday first. */
export function getWeekdayLabels(week: string[], dateLocale: string) {
  const format = new Intl.DateTimeFormat(dateLocale, { weekday: "short", timeZone: "UTC" });
  return week.map((day) => format.format(utcDay(day)));
}
