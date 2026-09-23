export const LANGS = ["vi", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "vi";
/** Cookie that remembers the interface language (not the language of articles). */
export const LANG_COOKIE = "cms_lang";

export function isLang(value: unknown): value is Lang {
  return (LANGS as readonly unknown[]).includes(value);
}
