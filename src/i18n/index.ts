import type { Lang } from "./config";
import activity from "./dict/activity";
import common from "./dict/common";
import editor from "./dict/editor";
import posts from "./dict/posts";
import users from "./dict/users";

/**
 * Every interface string, per language. Each area lives in its own file under ./dict with a
 * Vietnamese original and an English version of the same shape (TypeScript checks it).
 */
export const dictionaries = {
  vi: { common: common.vi, posts: posts.vi, editor: editor.vi, users: users.vi, activity: activity.vi },
  en: { common: common.en, posts: posts.en, editor: editor.en, users: users.en, activity: activity.en },
} satisfies Record<Lang, unknown>;

export type Dict = (typeof dictionaries)["vi"];

export function dictFor(lang: Lang): Dict {
  return dictionaries[lang];
}

export { fmt, plural } from "./format";
export { LANGS, DEFAULT_LANG, LANG_COOKIE, isLang, type Lang } from "./config";
