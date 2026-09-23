"use client";

import { createContext, useContext } from "react";
import type { Lang } from "./config";
import { dictFor, type Dict } from "./index";

const I18nContext = createContext<{ lang: Lang; t: Dict }>({ lang: "vi", t: dictFor("vi") });

/** Makes the interface language available to Client Components (set once in the root layout). */
export function I18nProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <I18nContext.Provider value={{ lang, t: dictFor(lang) }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
