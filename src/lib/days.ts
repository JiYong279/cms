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

/** Minutes a time zone is ahead of UTC at an instant (negative when behind). */
function getUtcOffsetMinutes(date: Date, timeZone: string) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value;
  // "GMT+07:00", "GMT-03:30", or plain "GMT" for UTC itself.
  const m = name?.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/** The instant on `day` with the same time of day as `at`, both read in a time zone. */
export function moveToDay(at: Date, day: string, timeZone: string) {
  const shifted = new Date(at.getTime() + daysBetween(getDayKey(at, timeZone), day) * DAY_MS);
  // A daylight-saving change in between would move the time of day: put it back.
  return new Date(shifted.getTime() + (getUtcOffsetMinutes(at, timeZone) - getUtcOffsetMinutes(shifted, timeZone)) * 60_000);
}

/** The Monday of the week `day` is in. */
export function getWeekStart(day: string) {
  // getUTCDay() counts from Sunday; weeks here start on Monday.
  return addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
}
