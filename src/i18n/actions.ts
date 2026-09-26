"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LANG_COOKIE, TIME_ZONE_COOKIE, isLang, isTimeZone } from "./config";

/** Switches the interface language and remembers it for a year. */
export async function setLanguage(lang: string) {
  if (!isLang(lang)) return;
  (await cookies()).set(LANG_COOKIE, lang, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  revalidatePath("/", "layout");
}

/**
 * Remembers the time zone of the visitor's device for a year. Returns whether it was saved: a zone the
 * browser knows but this server's Intl does not is left out, and dates stay in the default zone.
 * No sign-in needed: like the language, it is a display preference kept in the visitor's own browser.
 */
export async function setTimeZone(timeZone: string): Promise<boolean> {
  if (!isTimeZone(timeZone)) return false;
  (await cookies()).set(TIME_ZONE_COOKIE, timeZone, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  revalidatePath("/", "layout");
  return true;
}
