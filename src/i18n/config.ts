export const LANGS = ["vi", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "vi";
/** Cookie that remembers the interface language (not the language of articles). */
export const LANG_COOKIE = "cms_lang";

export function isLang(value: unknown): value is Lang {
  return (LANGS as readonly unknown[]).includes(value);
}

/** Cookie that remembers the time zone of the visitor's device, so the server prints dates in it. */
export const TIME_ZONE_COOKIE = "cms_tz";
/** Used until the browser has reported its own zone (first visit, cookies cleared, JavaScript off). */
export const DEFAULT_TIME_ZONE = "Asia/Ho_Chi_Minh";

/**
 * A time zone Intl can format dates in, aliases such as "Asia/Saigon" included. Not checked against
 * Intl.supportedValuesOf("timeZone"): that list holds only canonical names and leaves out
 * "Asia/Ho_Chi_Minh" and "UTC".
 */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch (error) {
    // A RangeError is how Intl says the zone is unknown: that is the answer, not a failure.
    if (error instanceof RangeError) return false;
    throw error;
  }
}
