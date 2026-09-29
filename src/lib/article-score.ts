import type { Locale, PostTranslation } from "@/db/schema";
import { isStale } from "./posts";
import { scoreArticle } from "./seo-score";

type Author = { jobTitles: Partial<Record<Locale, string>>; bios: Partial<Record<Locale, string>> };

type ScoredPost = {
  categoryId: string | null;
  coverImageUrl: string | null;
  translations: PostTranslation[];
  site: { baseUrl: string };
};

/** The SEO score of one language version of a saved article, as lists and the overview show it. */
export function scoreVersion(post: ScoredPost, tr: PostTranslation, author: Author | undefined) {
  const other = post.translations.find((x) => x.locale !== tr.locale);
  return scoreArticle({
    title: tr.title,
    metaTitle: tr.metaTitle,
    excerpt: tr.excerpt,
    metaDescription: tr.metaDescription,
    focusKeyword: tr.focusKeyword,
    slug: tr.slug,
    html: tr.contentHtml,
    categoryId: post.categoryId,
    coverImageUrl: post.coverImageUrl,
    coverImageAlt: tr.coverImageAlt,
    authorHasProfile: !!(author?.jobTitles[tr.locale]?.trim() || author?.bios[tr.locale]?.trim()),
    translationInSync: !!other && !isStale(tr, post.translations) && !isStale(other, post.translations),
    siteHost: new URL(post.site.baseUrl).host,
  });
}
