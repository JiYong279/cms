/** Calendar days as YYYY-MM-DD strings, counted in UTC so they never shift with the server's zone. */

const DAY_MS = 24 * 60 * 60_000;

/** The calendar day (YYYY-MM-DD) an instant falls on in a time zone. */
export function getDayKey(date: Date, timeZone: string) {
  // en-CA writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(date);
}

/** The day `n` days after `day` (before it when negative). */
export function addDays(day: string, n: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`. */
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** The Monday of the week `day` is in. */
export function getWeekStart(day: string) {
  // getUTCDay() counts from Sunday; weeks here start on Monday.
  return addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
}
