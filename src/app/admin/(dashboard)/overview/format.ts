/** A YYYY-MM-DD day, e.g. "29/9": calendar days are formatted in UTC so they never shift. */
export function formatShortDay(day: string, dateLocale: string) {
  return new Intl.DateTimeFormat(dateLocale, { day: "numeric", month: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

/** A YYYY-MM-DD day with its year, e.g. "29 thg 9, 2026". */
export function formatDay(day: string, dateLocale: string) {
  return new Intl.DateTimeFormat(dateLocale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

/** A YYYY-MM month, e.g. "thg 9" / "Sep". */
export function formatMonth(month: string, dateLocale: string) {
  return new Intl.DateTimeFormat(dateLocale, { month: "short", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}

/** "28/9–4/10" */
export function formatWeek(start: string, end: string, dateLocale: string) {
  return `${formatShortDay(start, dateLocale)}–${formatShortDay(end, dateLocale)}`;
}
