import Link from "next/link";
import { CalendarDays, List } from "lucide-react";
import { getT } from "@/i18n/server";
import { cn } from "@/lib/utils";

type Props = { current: "list" | "calendar"; site?: string };

/** Switches the articles between the list (/admin) and the editorial calendar, keeping the website filter. */
export async function PostsLayoutSwitch({ current, site }: Props) {
  const t = await getT();
  const query = site ? `?site=${encodeURIComponent(site)}` : "";
  const options = [
    { id: "list", href: `/admin${query}`, label: t.posts.layouts.list, icon: List },
    { id: "calendar", href: `/admin/calendar${query}`, label: t.posts.layouts.calendar, icon: CalendarDays },
  ] as const;

  return (
    <nav aria-label={t.posts.layoutLabel} className="flex rounded-lg bg-zinc-100 p-0.5">
      {options.map((o) => (
        <Link
          key={o.id}
          href={o.href}
          aria-current={current === o.id ? "page" : undefined}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
            current === o.id ? "bg-white font-medium text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800",
          )}
        >
          <o.icon className="size-4" />
          {o.label}
        </Link>
      ))}
    </nav>
  );
}
