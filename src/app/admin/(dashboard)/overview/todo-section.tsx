import Link from "next/link";
import { fmt } from "@/i18n";
import { getT } from "@/i18n/server";
import { ABANDONED_DRAFT_DAYS, TODO_KINDS, type TodoKind, type TodoVersion } from "@/lib/content-overview";
import { getDayKey } from "@/lib/days";
import { SCORE_THRESHOLDS } from "@/lib/seo-score";
import { formatDay } from "./format";

/** How many articles each reason lists. */
const SHOWN_PER_KIND = 5;

type Props = {
  todo: Record<TodoKind, TodoVersion[]>;
  ownOnly: boolean;
  timeZone: string;
};

export async function TodoSection({ todo, ownOnly, timeZone }: Props) {
  const t = await getT();
  const d = t.overview.todo;
  const kinds = TODO_KINDS.filter((k) => todo[k].length > 0);

  function detail(kind: TodoKind, v: TodoVersion) {
    switch (kind) {
      case "overdue":
        return fmt(d.details.overdue, { date: v.plannedFor ? formatDay(v.plannedFor, t.common.dateLocale) : "" });
      case "lowScore":
        return fmt(d.details.lowScore, { n: v.score });
      case "noLinks":
        return d.details.noLinks;
      case "missingImages":
        return fmt(d.details.missingImages, { n: v.imageSuggestions });
      case "outdated":
      case "abandoned":
        return fmt(d.details[kind], { date: formatDay(getDayKey(v.updatedAt, timeZone), t.common.dateLocale) });
    }
  }

  return (
    <section data-todo className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="font-semibold text-ink">{d.title}</h2>
      <p className="mt-1 text-sm text-zinc-500">
        {d.hint}
        {ownOnly && ` ${d.ownOnly}`}
      </p>
      {kinds.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">{d.none}</p>
      ) : (
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          {kinds.map((kind) => (
            <div key={kind} data-todo-kind={kind} className="min-w-0">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                {d.kinds[kind].title}
                <span className="rounded-full bg-amber-50 px-1.5 text-[11px] font-semibold tabular-nums text-amber-700 ring-1 ring-amber-200">{todo[kind].length}</span>
              </h3>
              <p className="mt-0.5 text-xs text-zinc-500">{fmt(d.kinds[kind].hint, { n: kind === "lowScore" ? SCORE_THRESHOLDS.ok : ABANDONED_DRAFT_DAYS })}</p>
              <ul className="mt-2 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                {todo[kind].slice(0, SHOWN_PER_KIND).map((v) => (
                  <li key={`${v.postId}-${v.locale}`}>
                    <Link href={`/admin/posts/${v.postId}?locale=${v.locale}`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-50">
                      <span className="shrink-0 rounded bg-zinc-100 px-1.5 text-[10px] font-semibold text-zinc-500">{v.locale.toUpperCase()}</span>
                      <span className="min-w-0 flex-1 truncate font-medium text-zinc-800">{v.title || d.untitled}</span>
                      <span className="shrink-0 text-xs text-zinc-500">{detail(kind, v)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {todo[kind].length > SHOWN_PER_KIND && <p className="mt-1.5 text-xs text-zinc-500">{fmt(d.more, { n: todo[kind].length - SHOWN_PER_KIND })}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
