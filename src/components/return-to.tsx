"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** The admin page (with its filters) the article editor's back button returns to, per browser tab. */
const STORAGE_KEY = "cms:return-to";

/** Only admin pages outside the editor: never another site, never the editor itself. */
function isReturnPath(value: string) {
  return /^\/admin(?:[/?]|$)/.test(value) && !value.startsWith("/admin/posts");
}

/**
 * Session storage is off in some private windows and when the browser blocks site data: that
 * browser gets the default page. Any other failure is a real error.
 */
function withStorage<T>(run: (storage: Storage) => T, otherwise: T): T {
  try {
    return run(window.sessionStorage);
  } catch (error) {
    if (error instanceof DOMException) return otherwise;
    throw error;
  }
}

/** Remembers the admin page being shown, filters included, as where the editor's back button goes. */
export function RememberReturnTo() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    // The address exactly as shown (pathname and search only tell when it changed).
    const path = window.location.pathname + window.location.search;
    if (isReturnPath(path)) withStorage((s) => s.setItem(STORAGE_KEY, path), undefined);
  }, [pathname, search]);
  return null;
}

const subscribe = () => () => {};

/** Where the editor's back button goes: the last admin page seen in this tab, or `fallback`. */
export function useReturnTo(fallback: string) {
  return useSyncExternalStore(
    subscribe,
    () => {
      const saved = withStorage((s) => s.getItem(STORAGE_KEY), null);
      return saved && isReturnPath(saved) ? saved : fallback;
    },
    () => fallback,
  );
}
