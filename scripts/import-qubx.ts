/**
 * One-off migration: replaces the sample content with the articles that were hard-coded
 * on qub-x.com (scripts/data/qubx-blog.json, Vietnamese originals + English translations).
 *
 *   npm run db:import-qubx -- --replace
 *
 * Deletes every existing post and category first, hence the explicit flag. Users are kept.
 * With the local PGlite database, stop `npm run dev` first (one process at a time).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../src/db";
import type { Locale } from "../src/db/schema";
import { slugify } from "../src/lib/posts";

type Section = { title: string; paragraphs: string[]; bullets?: string[] };
type Version = { slug: string; title: string; excerpt: string; metaDescription: string; sections: Section[] };
type Article = {
  category: Record<Locale, string>;
  featured: boolean;
  publishedAt: string;
  readingMinutes: number;
  vi: Version;
  en: Version;
};

const SITE_ID = "qubx";

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The same shape the editor produces: one H2 per section, paragraphs, then a bullet list. */
function toDocument(sections: Section[]) {
  const text = (value: string) => [{ type: "text", text: value }];
  const content = sections.flatMap((s) => [
    { type: "heading", attrs: { level: 2 }, content: text(s.title) },
    ...s.paragraphs.map((p) => ({ type: "paragraph", content: text(p) })),
    ...(s.bullets
      ? [
          {
            type: "bulletList",
            content: s.bullets.map((b) => ({ type: "listItem", content: [{ type: "paragraph", content: text(b) }] })),
          },
        ]
      : []),
  ]);
  const html = sections
    .map(
      (s) =>
        `<h2>${escapeHtml(s.title)}</h2>` +
        s.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("") +
        (s.bullets ? `<ul>${s.bullets.map((b) => `<li><p>${escapeHtml(b)}</p></li>`).join("")}</ul>` : ""),
    )
    .join("");
  return { json: { type: "doc", content }, html };
}

/** Must match the formula in app/admin/posts/actions.ts so stale-translation checks line up. */
function contentHash(title: string, excerpt: string, html: string) {
  return createHash("sha256").update(`${title}\n${excerpt}\n${html}`).digest("hex");
}

async function main() {
  if (!process.argv.includes("--replace")) {
    console.error("This deletes all posts and categories. Run again with --replace to continue.");
    process.exit(1);
  }

  const articles: Article[] = JSON.parse(
    readFileSync(path.join(import.meta.dirname, "data", "qubx-blog.json"), "utf8"),
  );
  const db = await getDb();

  const [admin] = await db.select().from(schema.users).where(eq(schema.users.role, "admin")).limit(1);
  if (!admin) throw new Error("Create an admin account first (npm run db:seed).");

  await db.transaction(async (tx) => {
    await tx.delete(schema.posts);
    await tx.delete(schema.categories);

    await tx
      .insert(schema.sites)
      .values({
        id: SITE_ID,
        name: "Qub-X",
        baseUrl: "https://www.qub-x.com",
        blogPaths: { en: "/blog", vi: "/vi/blog" },
        defaultLocale: "vi",
        revalidateUrl: process.env.QUBX_REVALIDATE_URL ?? "http://localhost:3000/api/cms/revalidate",
      })
      .onConflictDoUpdate({
        target: schema.sites.id,
        set: {
          name: "Qub-X",
          baseUrl: "https://www.qub-x.com",
          blogPaths: { en: "/blog", vi: "/vi/blog" },
          revalidateUrl: process.env.QUBX_REVALIDATE_URL ?? "http://localhost:3000/api/cms/revalidate",
        },
      });

    const categoryIds = new Map<string, string>();
    for (const a of articles) {
      if (categoryIds.has(a.category.vi)) continue;
      const [row] = await tx
        .insert(schema.categories)
        .values({
          siteId: SITE_ID,
          names: a.category,
          slugs: { vi: slugify(a.category.vi), en: slugify(a.category.en) },
          position: categoryIds.size,
        })
        .returning();
      categoryIds.set(a.category.vi, row.id);
    }

    for (const a of articles) {
      const publishedAt = new Date(a.publishedAt);
      const [post] = await tx
        .insert(schema.posts)
        .values({
          siteId: SITE_ID,
          categoryId: categoryIds.get(a.category.vi),
          authorId: admin.id,
          featured: a.featured,
          createdAt: publishedAt,
          updatedAt: publishedAt,
        })
        .returning();

      const versions: [Locale, Version][] = [
        ["vi", a.vi],
        ["en", a.en],
      ];
      let viHash = "";
      for (const [locale, v] of versions) {
        const { json, html } = toDocument(v.sections);
        const hash = contentHash(v.title, v.excerpt, html);
        if (locale === "vi") viHash = hash;
        await tx.insert(schema.postTranslations).values({
          postId: post.id,
          siteId: SITE_ID,
          locale,
          status: "published",
          title: v.title,
          slug: v.slug,
          excerpt: v.excerpt,
          contentJson: json,
          contentHtml: html,
          readingMinutes: a.readingMinutes,
          metaTitle: v.title,
          metaDescription: v.metaDescription,
          contentHash: hash,
          // English was translated from the Vietnamese original and is in sync with it.
          translatedFromLocale: locale === "en" ? "vi" : null,
          translatedFromHash: locale === "en" ? viHash : null,
          publishedAt,
          updatedBy: admin.id,
          createdAt: publishedAt,
          updatedAt: publishedAt,
        });
      }
    }
  });

  console.log(`Imported ${articles.length} Qub-X articles (vi + en) and ${new Set(articles.map((a) => a.category.vi)).size} categories.`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
