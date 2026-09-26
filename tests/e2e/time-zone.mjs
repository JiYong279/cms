// Dates on server-rendered pages follow the zone the browser reported (cms_tz cookie), not the
// server's own clock. Kiritimati (UTC+14) and Pago Pago (UTC-11) are 25 hours apart, so every date
// differs between them whatever the time of day and whatever zone the server runs in.
import { DEFAULT_TIME_ZONE } from "../../src/i18n/config.ts";
import { dictionaries } from "../../src/i18n/index.ts";
import { ADMIN, Client, check } from "./lib.mjs";

const admin = new Client();
await admin.login(ADMIN.email, ADMIN.password);
const locale = dictionaries.vi.common.dateLocale;

/** Each creation date on the users list, as shown and as the instant it stands for. */
async function createdDates(zone) {
  admin.cookies.set("cms_tz", zone);
  const r = await admin.req("/admin/users");
  return [...r.text.matchAll(/<time datetime="([^"]+)"[^>]*>([^<]+)<\/time>/gi)].map((m) => ({ at: m[1], shown: m[2] }));
}

function inZone(dates, zone) {
  const format = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: zone });
  return dates.length > 0 && dates.every((d) => d.shown === format.format(new Date(d.at)));
}

for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
  const dates = await createdDates(zone);
  check(`users list shows dates in ${zone}`, inZone(dates, zone), JSON.stringify(dates.slice(0, 3)));
}
const fallback = await createdDates("Not/A_Zone");
check("an unknown zone in the cookie falls back to the default", inZone(fallback, DEFAULT_TIME_ZONE), JSON.stringify(fallback.slice(0, 3)));

// What TimeZoneSync calls: a zone Intl knows is saved, anything else is left out.
admin.cookies.delete("cms_tz");
await admin.req("/admin/users");
await admin.call("/admin/users", "setTimeZone", ["<script>"]);
check("setTimeZone refuses a value that is not a time zone", !admin.cookies.has("cms_tz"));
await admin.call("/admin/users", "setTimeZone", ["Asia/Saigon"]);
// Cookie values travel URL-encoded ("Asia%2FSaigon"); the server reads them decoded.
const saved = decodeURIComponent(admin.cookies.get("cms_tz") ?? "");
check("setTimeZone saves a zone the browser reports", saved === "Asia/Saigon", saved);
