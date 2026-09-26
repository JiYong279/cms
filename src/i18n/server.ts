import { cache } from "react";
import { cookies } from "next/headers";
import { DEFAULT_LANG, DEFAULT_TIME_ZONE, LANG_COOKIE, TIME_ZONE_COOKIE, isLang, isTimeZone, type Lang } from "./config";
import { dictFor } from "./index";

/** The interface language chosen by the visitor (Server Components, Server Actions, Route Handlers). */
export const getLang = cache(async (): Promise<Lang> => {
  const value = (await cookies()).get(LANG_COOKIE)?.value;
  return isLang(value) ? value : DEFAULT_LANG;
});

/** The time zone of the visitor's device, as TimeZoneSync reported it; the default until it has. */
export const getTimeZone = cache(async (): Promise<string> => {
  const value = (await cookies()).get(TIME_ZONE_COOKIE)?.value;
  return isTimeZone(value) ? value : DEFAULT_TIME_ZONE;
});

export async function getT() {
  return dictFor(await getLang());
}
