// Moving a scheduled time to another day keeps its time of day, across months and daylight-saving changes.
//   npx tsx tests/seo/days.test.ts
import { moveToDay } from "../../src/lib/days";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `  -> ${detail}` : ""}`);
};
const iso = (d: Date) => d.toISOString();

// 08:00 in Vietnam is 01:00 UTC.
const vn = moveToDay(new Date("2026-10-13T01:00:00Z"), "2026-10-20", "Asia/Ho_Chi_Minh");
check("a week later, at the same time", iso(vn) === "2026-10-20T01:00:00.000Z", iso(vn));
// 23:30 on 31 October in Vietnam is still 30 October in UTC: the day is read in the time zone.
const late = moveToDay(new Date("2026-10-31T16:30:00Z"), "2026-11-03", "Asia/Ho_Chi_Minh");
check("the day is the one in the time zone, not in UTC", iso(late) === "2026-11-03T16:30:00.000Z", iso(late));
const back = moveToDay(new Date("2026-10-20T01:00:00Z"), "2026-10-15", "Asia/Ho_Chi_Minh");
check("an earlier day works too", iso(back) === "2026-10-15T01:00:00.000Z", iso(back));
// New York leaves summer time on 1 November 2026: 08:00 is 12:00 UTC before and 13:00 UTC after.
const ny = moveToDay(new Date("2026-10-30T12:00:00Z"), "2026-11-03", "America/New_York");
check("across the end of summer time the clock time stays 08:00", iso(ny) === "2026-11-03T13:00:00.000Z", iso(ny));
const nyBack = moveToDay(new Date("2026-11-03T13:00:00Z"), "2026-10-30", "America/New_York");
check("and back again", iso(nyBack) === "2026-10-30T12:00:00.000Z", iso(nyBack));
const utc = moveToDay(new Date("2026-10-13T09:15:00Z"), "2026-10-14", "UTC");
check("UTC itself", iso(utc) === "2026-10-14T09:15:00.000Z", iso(utc));

console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
process.exit(failures ? 1 : 0);
