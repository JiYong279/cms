import Link from "next/link";
import { and, asc, count, desc, eq, type SQL } from "drizzle-orm";
import { FileText, KeyRound, Settings, UserCog, type LucideIcon } from "lucide-react";
import { getDb, schema } from "@/db";
import { NoAccess } from "@/components/no-access";
import { dictionaries, fmt, type Dict } from "@/i18n";
import { getT } from "@/i18n/server";
import { ACTIVITY_GROUPS, type ActivityGroup } from "@/lib/activity";
import { describeActivity } from "@/lib/activity-text";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t.activity.metaTitle} · ${t.common.appName}` };
}

const PAGE_SIZE = 50;
type Group = ActivityGroup;
const ICONS: Record<Group, LucideIcon> = { post: FileText, user: UserCog, site: Settings, auth: KeyRound };
const TONES: Record<string, string> = {
  "post.published": "bg-emerald-50 text-emerald-700",
  "post.scheduled": "bg-sky-50 text-sky-700",
  "post.unpublished": "bg-amber-50 text-amber-700",
  "post.trashed": "bg-red-50 text-red-600",
  "post.deleted": "bg-red-50 text-red-600",
  "post.purged": "bg-red-50 text-red-600",
  "post.auto_published": "bg-emerald-50 text-emerald-700",
  "user.locked": "bg-red-50 text-red-600",
};

function formatWhen(date: Date, t: Dict) {
  return new Intl.DateTimeFormat(t.common.dateLocale, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(date);
}

function dayLabel(date: Date, t: Dict) {
  return new Intl.DateTimeFormat(t.common.dateLocale, {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date);
}

export default async function ActivityPage({ searchParams }: PageProps<"/admin/activity">) {
  const me = await requireUser();
  const t = await getT();
  if (!can(me.role, "activity.view")) return <NoAccess message={t.activity.noAccess} />;

  const params = await searchParams;
  const pick = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);
  const group = ACTIVITY_GROUPS.find((g) => g === pick(params.type));
  const userId = pick(params.user);
  const page = Math.max(1, Number(pick(params.page)) || 1);

  const db = await getDb();
  const users = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).orderBy(asc(schema.users.name));
  const conditions: SQL[] = [];
  if (group) conditions.push(eq(schema.activityLog.entityType, group));
  if (userId && users.some((u) => u.id === userId)) conditions.push(eq(schema.activityLog.userId, userId));
  const where = conditions.length ? and(...conditions) : undefined;

  const [{ total }] = await db.select({ total: count() }).from(schema.activityLog).where(where);
  const entries = await db
    .select({
      id: schema.activityLog.id,
      at: schema.activityLog.at,
      action: schema.activityLog.action,
      entityType: schema.activityLog.entityType,
      entityId: schema.activityLog.entityId,
      summary: schema.activityLog.summary,
      meta: schema.activityLog.meta,
      who: schema.users.name,
      siteName: schema.sites.name,
    })
    .from(schema.activityLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.activityLog.userId))
    .leftJoin(schema.sites, eq(schema.sites.id, schema.activityLog.siteId))
    .where(where)
    .orderBy(desc(schema.activityLog.at))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  // Articles that still exist can be opened from the log.
  const postIds = [...new Set(entries.filter((e) => e.entityType === "post" && e.entityId).map((e) => e.entityId!))];
  const existing = new Set(
    postIds.length
      ? (await db.query.posts.findMany({ where: (p, { inArray }) => inArray(p.id, postIds), columns: { id: true } })).map((p) => p.id)
      : [],
  );

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (change: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ type: group, user: userId, page: undefined, ...change })) if (v) next.set(k, v);
    const q = next.toString();
    return q ? `/admin/activity?${q}` : "/admin/activity";
  };

  // A date header above the first entry of each day.
  const days = entries.map((e) => dayLabel(e.at, t));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t.activity.title}</h1>
      <p className="mt-1 text-sm text-zinc-500">{t.activity.subtitle}</p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <nav className="flex rounded-lg bg-zinc-100 p-0.5" aria-label={t.activity.kindLabel}>
          {[{ id: undefined, label: t.activity.all }, ...ACTIVITY_GROUPS.map((id) => ({ id, label: t.activity.groups[id] }))].map(
            (g) => (
              <Link
                key={g.id ?? "all"}
                href={href({ type: g.id })}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm",
                  group === g.id ? "bg-white font-medium text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800",
                )}
              >
                {g.label}
              </Link>
            ),
          )}
        </nav>
        <form action="/admin/activity" className="ml-auto flex items-center gap-2">
          {group && <input type="hidden" name="type" value={group} />}
          <select
            name="user"
            defaultValue={userId ?? ""}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand"
          >
            <option value="">{t.activity.everyone}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50">
            {t.activity.filter}
          </button>
        </form>
      </div>

      <section className="mt-6 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        {entries.length === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-zinc-500">{t.activity.empty}</p>
        ) : (
          <ol>
            {entries.map((e, i) => {
              const Icon = ICONS[e.entityType as Group] ?? FileText;
              const day = days[i];
              const showDay = i === 0 || days[i - 1] !== day;
              const rawTitle = typeof e.meta?.title === "string" ? e.meta.title : null;
              // Older entries stored the Vietnamese "(untitled)" placeholder itself.
              const title = rawTitle === null ? null : rawTitle && rawTitle !== dictionaries.vi.common.untitled ? rawTitle : t.common.untitled;
              const target =
                e.entityType === "post" && e.entityId && existing.has(e.entityId)
                  ? `/admin/posts/${e.entityId}`
                  : e.entityType === "user" && e.entityId
                    ? `/admin/users/${e.entityId}`
                    : e.entityType === "site"
                      ? "/admin/settings"
                      : null;
              return (
                <li key={e.id}>
                  {showDay && (
                    <p className="border-y border-zinc-100 bg-zinc-50 px-4 py-1.5 text-xs font-semibold capitalize text-zinc-500 first:border-t-0">
                      {day}
                    </p>
                  )}
                  <div className="flex items-start gap-3 px-4 py-3">
                    <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", TONES[e.action] ?? "bg-zinc-100 text-zinc-500")}>
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="text-zinc-800">
                        <span className="font-semibold">{e.who ?? t.common.system}</span> · {describeActivity(e, t)}
                      </p>
                      {(title || e.siteName) && (
                        <p className="mt-0.5 truncate text-xs text-zinc-500">
                          {e.siteName && <span className="mr-1.5 rounded bg-zinc-100 px-1.5 py-px font-medium text-zinc-600">{e.siteName}</span>}
                          {title &&
                            (target ? (
                              <Link href={target} className="hover:text-brand hover:underline">
                                {title}
                              </Link>
                            ) : (
                              title
                            ))}
                        </p>
                      )}
                    </div>
                    <time dateTime={e.at.toISOString()} className="shrink-0 text-xs text-zinc-400">
                      {formatWhen(e.at, t)}
                    </time>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label={t.activity.pagesLabel}>
          <span className="text-zinc-500">{fmt(t.activity.pageOf, { page, pages, total })}</span>
          <span className="flex gap-2">
            {page > 1 && (
              <Link href={href({ page: String(page - 1) })} className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 hover:bg-zinc-50">
                {t.activity.newer}
              </Link>
            )}
            {page < pages && (
              <Link href={href({ page: String(page + 1) })} className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 hover:bg-zinc-50">
                {t.activity.older}
              </Link>
            )}
          </span>
        </nav>
      )}
    </div>
  );
}
