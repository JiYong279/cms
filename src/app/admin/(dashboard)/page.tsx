import Link from "next/link";
import { count, desc, isNull } from "drizzle-orm";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Search } from "lucide-react";
import { getDb, schema } from "@/db";
import type { PostStatus } from "@/db/schema";
import { fmt, type Dict } from "@/i18n";
import { getLang, getT } from "@/i18n/server";
import { requireUser } from "@/lib/auth";
import { can, canDeletePost } from "@/lib/permissions";
import { LOCALES, isStale, slugify, viewOrigin } from "@/lib/posts";
import { publishDuePosts } from "@/lib/scheduled";
import { cn } from "@/lib/utils";
import { NewPostButton } from "./new-post-button";
import { PostTable, type PostRow } from "./post-table";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t.posts.metaTitle} · ${t.common.appName}` };
}

const VIEWS = ["all", "published", "draft", "in_review", "scheduled", "trash"] as const;
type View = (typeof VIEWS)[number];

function relativeTime(date: Date, t: Dict) {
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return t.common.relative.justNow;
  if (minutes < 60) return fmt(t.common.relative.minutes, { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return fmt(t.common.relative.hours, { n: hours });
  const days = Math.round(hours / 24);
  if (days < 7) return fmt(t.common.relative.days, { n: days });
  return new Intl.DateTimeFormat(t.common.dateLocale, { dateStyle: "medium" }).format(date);
}

/** Keeps the other filters when one of them changes. */
function hrefWith(current: Record<string, string | undefined>, change: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, ...change })) if (v && !(k === "view" && v === "all")) params.set(k, v);
  const query = params.toString();
  return query ? `/admin?${query}` : "/admin";
}

export default async function PostsPage({ searchParams }: PageProps<"/admin">) {
  const user = await requireUser();
  const t = await getT();
  const lang = await getLang();
  await publishDuePosts();
  const seesAll = can(user.role, "posts.editAny");
  const params = await searchParams;
  const pick = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);
  const db = await getDb();

  // The busiest website comes first and is preselected when writing a new article.
  const postCounts = new Map(
    (
      await db
        .select({ siteId: schema.posts.siteId, n: count() })
        .from(schema.posts)
        // Articles in the trash do not count.
        .where(isNull(schema.posts.deletedAt))
        .groupBy(schema.posts.siteId)
    ).map(
      (r) => [r.siteId, r.n],
    ),
  );
  const sites = (await db.select().from(schema.sites)).sort(
    (a, b) => (postCounts.get(b.id) ?? 0) - (postCounts.get(a.id) ?? 0) || a.name.localeCompare(b.name),
  );
  const site = sites.find((s) => s.id === pick(params.site))?.id;
  // "status" is the older name of the view parameter; links using it keep working.
  const view: View = VIEWS.find((v) => v === (pick(params.view) ?? pick(params.status))) ?? "all";
  const q = pick(params.q)?.trim();
  const filters = { site, view, q };

  const everything = await db.query.posts.findMany({
    where: (p, { and, eq }) =>
      and(site ? eq(p.siteId, site) : undefined, seesAll ? undefined : eq(p.authorId, user.id)),
    with: { translations: true, category: true, site: true, author: { columns: { name: true } } },
    orderBy: [desc(schema.posts.updatedAt)],
  });
  const active = everything.filter((p) => !p.deletedAt);
  const trashed = everything.filter((p) => p.deletedAt);
  const hasStatus = (p: (typeof everything)[number], s: PostStatus) => p.translations.some((tr) => tr.status === s);
  const counts: Record<View, number> = {
    all: active.length,
    published: active.filter((p) => hasStatus(p, "published")).length,
    draft: active.filter((p) => hasStatus(p, "draft")).length,
    in_review: active.filter((p) => hasStatus(p, "in_review")).length,
    scheduled: active.filter((p) => hasStatus(p, "scheduled")).length,
    trash: trashed.length,
  };

  // Search ignores accents, so "toi uu" finds "tối ưu".
  const needle = q ? slugify(q) : "";
  const shown = (view === "trash" ? trashed : view === "all" ? active : active.filter((p) => hasStatus(p, view))).filter(
    (p) => !needle || p.translations.some((tr) => slugify(tr.title).includes(needle)),
  );

  const userNames = new Map(
    (await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users)).map((u) => [u.id, u.name]),
  );
  const rows: PostRow[] = shown.map((post) => {
    const main = post.translations.find((tr) => tr.locale === post.site.defaultLocale) ?? post.translations[0];
    const locale = main?.locale ?? post.site.defaultLocale;
    return {
      id: post.id,
      title: main?.title || "",
      href: `/admin/posts/${post.id}?locale=${locale}`,
      siteName: post.site.name,
      // Category names exist per language; show the one matching the interface.
      category: post.category ? (post.category.names[lang] ?? post.category.names.vi ?? null) : null,
      featured: post.featured,
      coverImageUrl: post.coverImageUrl,
      author: post.author?.name ?? null,
      locales: LOCALES.map((l) => {
        const tr = post.translations.find((x) => x.locale === l);
        return {
          locale: l,
          href: `/admin/posts/${post.id}?locale=${l}`,
          status: tr?.status ?? null,
          stale: !!tr && isStale(tr, post.translations),
        };
      }),
      publicUrl:
        main?.status === "published" ? `${viewOrigin(post.site)}${post.site.blogPaths[locale]}/${main.slug}` : null,
      updatedLabel: relativeTime(post.updatedAt, t),
      trashedLabel: post.deletedAt
        ? `${relativeTime(post.deletedAt, t)}${post.deletedBy ? ` · ${userNames.get(post.deletedBy) ?? "?"}` : ""}`
        : null,
      canDelete: canDeletePost(user, post, post.translations.map((tr) => tr.status)),
    };
  });

  // Cards count articles, like the tabs below; the line underneath splits them by language.
  const byLocale = (match: (tr: (typeof active)[number]["translations"][number], all: (typeof active)[number]["translations"]) => boolean) =>
    LOCALES.map((l) => `${l.toUpperCase()} ${active.filter((p) => p.translations.some((tr) => tr.locale === l && match(tr, p.translations))).length}`).join(" · ");
  const staleArticles = active.filter((p) => p.translations.some((tr) => isStale(tr, p.translations))).length;
  const stats = [
    { label: t.posts.stats.published, value: counts.published, detail: byLocale((tr) => tr.status === "published"), icon: CheckCircle2, tone: "text-emerald-600 bg-emerald-50", view: "published" },
    { label: t.posts.stats.in_review, value: counts.in_review, detail: byLocale((tr) => tr.status === "in_review"), icon: Clock, tone: "text-amber-600 bg-amber-50", view: "in_review" },
    { label: t.posts.stats.scheduled, value: counts.scheduled, detail: byLocale((tr) => tr.status === "scheduled"), icon: CalendarClock, tone: "text-sky-600 bg-sky-50", view: "scheduled" },
    { label: t.posts.stats.stale, value: staleArticles, detail: byLocale((tr, all) => isStale(tr, all)), icon: AlertTriangle, tone: "text-orange-600 bg-orange-50", view: undefined },
  ] as const;

  const inFilter = !!q || view !== "all";

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.posts.title}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {seesAll ? fmt(t.posts.subtitleAll, { sites: sites.map((s) => s.name).join(t.posts.and) }) : t.posts.subtitleOwn}
          </p>
        </div>
        <NewPostButton
          sites={sites.map((s) => ({ id: s.id, name: s.name, baseUrl: s.baseUrl, posts: postCounts.get(s.id) ?? 0 }))}
          defaultSiteId={site}
        />
      </header>

      <section className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => {
          const body = (
            <>
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", s.tone)}>
                <s.icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-2xl font-semibold tabular-nums">{s.value}</span>
                <span className="block text-xs text-zinc-500">{s.label}</span>
                <span className="block text-[11px] tabular-nums text-zinc-400">{s.detail}</span>
              </span>
            </>
          );
          const cls = cn(
            "flex items-center gap-3 rounded-xl border bg-white p-4 shadow-sm transition",
            s.view && view === s.view ? "border-brand-light ring-2 ring-brand-tint" : "border-zinc-200",
            s.view && "hover:border-zinc-300",
          );
          return s.view ? (
            <Link key={s.label} href={hrefWith(filters, { view: view === s.view ? undefined : s.view })} className={cls}>
              {body}
            </Link>
          ) : (
            <div key={s.label} className={cls}>
              {body}
            </div>
          );
        })}
      </section>

      <section className="mt-6 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <nav className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-zinc-200 px-3" aria-label={t.posts.viewsLabel}>
          {VIEWS.map((v) => (
            <Link
              key={v}
              href={hrefWith(filters, { view: v })}
              className={cn(
                "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-sm",
                view === v ? "border-brand font-semibold text-ink" : "border-transparent text-zinc-500 hover:text-zinc-800",
                v === "trash" && "ml-auto",
              )}
            >
              {t.posts.views[v]}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                  view === v ? "bg-brand-tint text-brand" : "bg-zinc-100 text-zinc-500",
                )}
              >
                {counts[v]}
              </span>
            </Link>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 p-3">
          <nav className="flex rounded-lg bg-zinc-100 p-0.5" aria-label={t.posts.sitesLabel}>
            {[{ id: undefined, name: t.posts.allSites }, ...sites].map((s) => (
              <Link
                key={s.id ?? "all"}
                href={hrefWith(filters, { site: s.id })}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm",
                  site === s.id ? "bg-white font-medium text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800",
                )}
              >
                {s.name}
              </Link>
            ))}
          </nav>
          <form className="relative ml-auto w-full sm:w-72" action="/admin">
            {site && <input type="hidden" name="site" value={site} />}
            {view !== "all" && <input type="hidden" name="view" value={view} />}
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input
              name="q"
              defaultValue={q}
              placeholder={t.posts.search}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-bright focus:bg-white focus:ring-2 focus:ring-brand-bright/20"
            />
          </form>
        </div>

        {view === "trash" && (
          <p className="border-b border-zinc-100 bg-amber-50/60 px-4 py-2 text-xs text-amber-800">{t.posts.trashNote}</p>
        )}
        {q && (
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 bg-zinc-50/60 px-4 py-2 text-xs text-zinc-600">
            {t.posts.searching} <span className="rounded-full bg-zinc-200 px-2 py-0.5 font-medium">“{q}”</span>
            <Link href={hrefWith({ site, view }, {})} className="ml-1 font-medium text-brand hover:text-brand-hover">
              {t.posts.clearSearch}
            </Link>
          </div>
        )}

        <PostTable
          key={`${view}-${site ?? ""}-${q ?? ""}`}
          rows={rows}
          trash={view === "trash"}
          canPurge={can(user.role, "posts.deleteAny")}
          emptyTitle={view === "trash" ? t.posts.empty.trashTitle : inFilter ? t.posts.empty.filteredTitle : t.posts.empty.noneTitle}
          emptyHint={view === "trash" ? t.posts.empty.trashHint : inFilter ? t.posts.empty.filteredHint : t.posts.empty.noneHint}
        />
      </section>
    </div>
  );
}
