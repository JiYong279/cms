import { notFound } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Locale } from "@/db/schema";
import { NoAccess } from "@/components/no-access";
import { getT, getTimeZone } from "@/i18n/server";
import { describeActivity } from "@/lib/activity-text";
import { requireUser } from "@/lib/auth";
import { ROLES, can, canDeletePost, canEditPost, canEditTranslation } from "@/lib/permissions";
import { aiConfigured } from "@/lib/ai";
import { getLinkTargets } from "@/lib/link-targets";
import { LOCALES, isStale, viewOrigin } from "@/lib/posts";
import { PostEditor, type LocaleTab } from "./post-editor";

// The AI assistant's Server Actions run on this page and may take a couple of minutes.
export const maxDuration = 300;

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t.editor.metaTitle} · ${t.common.appName}` };
}

export default async function EditPostPage({ params, searchParams }: PageProps<"/admin/posts/[id]">) {
  const user = await requireUser();
  const t = await getT();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const db = await getDb();
  const post = await db.query.posts.findFirst({
    where: (p, { eq }) => eq(p.id, id),
    with: { translations: true, site: true },
  });
  if (!post) notFound();
  if (!canEditPost(user, post)) return <NoAccess message={t.editor.noAccess} />;

  const { locale: localeParam, ai, engine } = await searchParams;
  const locale: Locale = LOCALES.find((l) => l === localeParam) ?? post.site.defaultLocale;
  const translation = post.translations.find((tr) => tr.locale === locale) ?? null;
  // Counted by the SEO score: articles by an author with a public profile show a real byline.
  const [author] = post.authorId
    ? await db
        .select({ jobTitles: schema.users.jobTitles, bios: schema.users.bios })
        .from(schema.users)
        .where(eq(schema.users.id, post.authorId))
        .limit(1)
    : [];
  const authorHasProfile = !!(author?.jobTitles[locale]?.trim() || author?.bios[locale]?.trim());

  // Who moved it to the trash, and the latest activity, for the editor sidebar.
  const trashedBy = post.deletedBy
    ? (await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, post.deletedBy)).limit(1))[0]?.name
    : null;
  const history = await db
    .select({
      at: schema.activityLog.at,
      action: schema.activityLog.action,
      summary: schema.activityLog.summary,
      meta: schema.activityLog.meta,
      who: schema.users.name,
    })
    .from(schema.activityLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.activityLog.userId))
    .where(and(eq(schema.activityLog.entityType, "post"), eq(schema.activityLog.entityId, post.id)))
    .orderBy(desc(schema.activityLog.at))
    .limit(10);

  // Who may look after the article: active editors and admins, and whoever looks after it now.
  const assignees = (
    await db
      .select({ id: schema.users.id, name: schema.users.name, role: schema.users.role, active: schema.users.active })
      .from(schema.users)
      .where(inArray(schema.users.role, ROLES.filter((r) => can(r, "posts.editAny"))))
  )
    .filter((u) => u.active || u.id === post.assigneeId)
    .sort((a, b) => a.name.localeCompare(b.name));

  const categories = await db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.siteId, post.siteId));

  const locales: LocaleTab[] = LOCALES.map((l) => {
    const tr = post.translations.find((x) => x.locale === l);
    return { locale: l, status: tr?.status ?? null, stale: !!tr && isStale(tr, post.translations) };
  });

  return (
    <PostEditor
      // A fresh editor per language, so state never leaks between them.
      key={locale}
      post={{
        id: post.id,
        categoryId: post.categoryId,
        featured: post.featured,
        pillar: post.pillar,
        coverImageUrl: post.coverImageUrl,
      }}
      locale={locale}
      locales={locales}
      translation={translation}
      staleSource={translation && isStale(translation, post.translations) ? translation.translatedFromLocale : null}
      site={{
        id: post.site.id,
        name: post.site.name,
        baseUrl: post.site.baseUrl,
        brief: post.site.contentBrief,
        viewOrigin: viewOrigin(post.site),
        blogPath: post.site.blogPaths[locale],
      }}
      categories={categories.map((c) => ({ id: c.id, name: c.names[locale] ?? c.names.vi ?? "" }))}
      planning={{
        plannedFor: post.plannedFor,
        assigneeId: post.assigneeId,
        assignees: assignees.map((a) => ({ id: a.id, name: a.name })),
        canAssign: can(user.role, "posts.assign"),
      }}
      canPublish={can(user.role, "posts.publish")}
      locked={!canEditTranslation(user, translation?.status ?? null)}
      canDelete={canDeletePost(user, post, post.translations.map((tr) => tr.status))}
      aiEnabled={aiConfigured()}
      linkTargets={await getLinkTargets({ siteId: post.siteId, locale, excludePostId: post.id, categoryId: post.categoryId })}
      openAi={ai === "translate" ? "translate" : null}
      aiEngine={engine === "own" || engine === "builtin" ? engine : null}
      authorHasProfile={authorHasProfile}
      timeZone={await getTimeZone()}
      trashed={post.deletedAt ? { at: post.deletedAt, by: trashedBy ?? null } : null}
      history={history.map((h) => ({
        at: h.at,
        who: h.who ?? t.common.system,
        summary: describeActivity({ action: h.action, summary: h.summary, meta: h.meta, siteName: post.site.name }, t),
      }))}
    />
  );
}
