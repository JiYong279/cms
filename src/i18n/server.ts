import { cache } from "react";
import { cookies } from "next/headers";
import { DEFAULT_LANG, LANG_COOKIE, isLang, type Lang } from "./config";
import { dictFor } from "./index";

/** The interface language chosen by the visitor (Server Components, Server Actions, Route Handlers). */
export const getLang = cache(async (): Promise<Lang> => {
  const value = (await cookies()).get(LANG_COOKIE)?.value;
  return isLang(value) ? value : DEFAULT_LANG;
});

export async function getT() {
  return dictFor(await getLang());
}
