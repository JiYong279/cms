"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { setTimeZone } from "@/i18n/actions";

/**
 * The server cannot see the visitor's time zone, so the browser reports it: when it differs from the
 * zone this page was rendered in (`current`), it is saved in a cookie and the page is rendered again.
 */
export function TimeZoneSync({ current }: { current: string }) {
  const router = useRouter();

  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone === current) return;
    setTimeZone(zone).then((saved) => {
      if (saved) router.refresh();
    });
  }, [current, router]);

  return null;
}
