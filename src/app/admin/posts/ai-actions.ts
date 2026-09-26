"use server";

import { and, count, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Locale } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { AiError, DRAFT_LENGTHS, draftArticle, translateArticle, type ArticleFields, type SiteContext } from "@/lib/ai";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { categoryName } from "@/lib/categories";
import { canEditPost, canEditTranslation } from "@/lib/permissions";
import { fmt } from "@/i18n";
import { getT } from "@/i18n/server";

/** `categoryId`: the category the AI picked for a draft, if any. */
export type AiResult = { ok: true; article: ArticleFields & { categoryId: string | null } } | { ok: false; error: string };

const AI_ACTIONS = ["post.ai_drafted", "post.ai_translated"];
// Each run costs money: a generous cap per person per day stops runaway use.
const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 30;

const localeSchema = z.enum(schema.localeEnum.enumValues);

const DraftInput = z.object({
  postId: z.uuid(),
  locale: localeSchema,
  topic: z.string().trim().min(3).max(500),
  keyPoints: z.string().trim().max(3000),
  focusKeyword: z.string().trim().max(100),
  length: z.enum(Object.keys(DRAFT_LENGTHS) as [keyof typeof DRAFT_LENGTHS]),
});

const SourceInput = z.object({ postId: z.uuid(), from: localeSchema });

const TranslateInput = z.object({
  postId: z.uuid(),
  from: localeSchema,
  to: localeSchema,
});

type Dict = Awaited<ReturnType<typeof getT>>;

/** The article and its website, when `user` may write its `locale` version; otherwise the reason not. */
async function loadForAi(user: CurrentUser, postId: string, locale: Locale, t: Dict) {
  const e = t.editor.ai.errors;
  const db = await getDb();
  const post = await db.query.posts.findFirst({
    where: (p, { eq }) => eq(p.id, postId),
    with: { site: true, translations: true },
  });
  if (!post) return { error: t.posts.errors.notFound };
  if (post.deletedAt) return { error: t.posts.errors.trashed };
  if (!canEditPost(user, post)) return { error: t.posts.errors.notAllowedEdit };
  const target = post.translations.find((tr) => tr.locale === locale);
  if (!canEditTranslation(user, target?.status ?? null)) return { error: t.posts.errors.liveLocked };

  const [{ used }] = await db
    .select({ used: count() })
    .from(schema.activityLog)
    .where(
      and(
        eq(schema.activityLog.userId, user.id),
        inArray(schema.activityLog.action, AI_ACTIONS),
        gt(schema.activityLog.at, new Date(Date.now() - 24 * 60 * 60_000)),
      ),
    );
  if (used >= DAILY_LIMIT) return { error: fmt(e.dailyLimit, { n: DAILY_LIMIT }) };

  const [glossary, categories] = await Promise.all([
    db
      .select({ vi: schema.glossary.vi, en: schema.glossary.en, note: schema.glossary.note })
      .from(schema.glossary)
      .where(eq(schema.glossary.siteId, post.siteId)),
    db.select().from(schema.categories).where(eq(schema.categories.siteId, post.siteId)),
  ]);
  const site: SiteContext = {
    name: post.site.name,
    baseUrl: post.site.baseUrl,
    glossary,
    categories: categories.map((c) => categoryName(c, locale)),
  };
  return { post, site, categories };
}

function failure(error: unknown, t: Dict): { ok: false; error: string } {
  if (error instanceof AiError) return { ok: false, error: t.editor.ai.errors[error.code] };
  console.error("[ai] unexpected failure:", error);
  return { ok: false, error: t.editor.ai.errors.unavailable };
}

/** Writes a first draft of the `locale` version from a topic. Nothing is saved. */
export async function aiDraft(raw: z.input<typeof DraftInput>): Promise<AiResult> {
  const user = await requireUser();
  const t = await getT();
  const parsed = DraftInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.path[0] === "topic" ? t.editor.ai.errors.topic : t.posts.errors.invalid };
  }
  const input = parsed.data;
  const loaded = await loadForAi(user, input.postId, input.locale, t);
  if ("error" in loaded) return { ok: false, error: loaded.error as string };

  try {
    const article = await draftArticle({ ...input, siteId: loaded.post.siteId, site: loaded.site });
    const category = loaded.categories.find((c) => categoryName(c, input.locale) === article.category);
    await logActivity({
      userId: user.id,
      action: "post.ai_drafted",
      entityType: "post",
      entityId: input.postId,
      siteId: loaded.post.siteId,
      meta: { locale: input.locale, topic: input.topic },
    });
    return { ok: true, article: { ...article, categoryId: category?.id ?? null } };
  } catch (error) {
    return failure(error, t);
  }
}

/** Translates the saved `from` version into `to`. Nothing is saved. */
export async function aiTranslate(raw: z.input<typeof TranslateInput>): Promise<AiResult> {
  const user = await requireUser();
  const t = await getT();
  const parsed = TranslateInput.safeParse(raw);
  if (!parsed.success || parsed.data.from === parsed.data.to) return { ok: false, error: t.posts.errors.invalid };
  const input = parsed.data;
  const loaded = await loadForAi(user, input.postId, input.to, t);
  if ("error" in loaded) return { ok: false, error: loaded.error as string };

  const source = loaded.post.translations.find((tr) => tr.locale === input.from);
  if (!source || !source.title.trim() || !source.contentHtml.trim()) {
    return { ok: false, error: fmt(t.editor.ai.errors.noSource, { language: t.common.locales[input.from] }) };
  }

  try {
    const article = await translateArticle({
      siteId: loaded.post.siteId,
      site: loaded.site,
      from: input.from,
      to: input.to,
      source: {
        title: source.title,
        excerpt: source.excerpt,
        metaTitle: source.metaTitle,
        metaDescription: source.metaDescription,
        focusKeyword: source.focusKeyword,
        html: source.contentHtml,
      },
    });
    await logActivity({
      userId: user.id,
      action: "post.ai_translated",
      entityType: "post",
      entityId: input.postId,
      siteId: loaded.post.siteId,
      meta: { locale: input.to, source: input.from, title: source.title },
    });
    // Articles share one category across languages, so a translation leaves it alone.
    return { ok: true, article: { ...article, categoryId: null } };
  } catch (error) {
    return failure(error, t);
  }
}

export type SourceResult =
  | { ok: true; source: { title: string; excerpt: string; metaTitle: string; metaDescription: string; focusKeyword: string; html: string } }
  | { ok: false; error: string };

/** The saved `from` version, put into the translation prompt people copy into their own assistant. */
export async function aiSourceArticle(raw: z.input<typeof SourceInput>): Promise<SourceResult> {
  const user = await requireUser();
  const t = await getT();
  const parsed = SourceInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: t.posts.errors.invalid };
  const db = await getDb();
  const post = await db.query.posts.findFirst({
    where: (p, { eq }) => eq(p.id, parsed.data.postId),
    with: { translations: true },
  });
  if (!post || post.deletedAt) return { ok: false, error: t.posts.errors.notFound };
  if (!canEditPost(user, post)) return { ok: false, error: t.posts.errors.notAllowedEdit };
  const s = post.translations.find((tr) => tr.locale === parsed.data.from);
  if (!s || !s.title.trim() || !s.contentHtml.trim()) {
    return { ok: false, error: fmt(t.editor.ai.errors.noSource, { language: t.common.locales[parsed.data.from] }) };
  }
  return {
    ok: true,
    source: {
      title: s.title,
      excerpt: s.excerpt,
      metaTitle: s.metaTitle,
      metaDescription: s.metaDescription,
      focusKeyword: s.focusKeyword,
      html: s.contentHtml,
    },
  };
}
