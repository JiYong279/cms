import type { Metadata } from "next";
import { asc, count, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { NoAccess } from "@/components/no-access";
import { getT } from "@/i18n/server";
import { requireUser } from "@/lib/auth";
import { categorySlug } from "@/lib/categories";
import { can } from "@/lib/permissions";
import { CategoryList, type CategoryRow } from "./category-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t.categories.metaTitle} · ${t.common.appName}` };
}

export default async function CategoriesPage() {
  const me = await requireUser();
  const t = await getT();
  if (!can(me.role, "categories.manage")) return <NoAccess message={t.categories.noAccess} />;

  const db = await getDb();
  const [sites, categories, counts] = await Promise.all([
    db.select().from(schema.sites).orderBy(asc(schema.sites.name)),
    db.select().from(schema.categories).orderBy(asc(schema.categories.position), asc(schema.categories.createdAt)),
    // Articles in the trash do not count.
    db
      .select({ categoryId: schema.posts.categoryId, n: count() })
      .from(schema.posts)
      .where(isNull(schema.posts.deletedAt))
      .groupBy(schema.posts.categoryId),
  ]);
  const postCounts = new Map(counts.map((c) => [c.categoryId, c.n]));
  const categoriesOf = (siteId: string) => categories.filter((c) => c.siteId === siteId).length;
  // Websites with categories first.
  sites.sort((a, b) => categoriesOf(b.id) - categoriesOf(a.id));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t.categories.title}</h1>
      <p className="mt-1 text-sm text-zinc-500">{t.categories.subtitle}</p>

      <div className="mt-8 flex flex-col gap-8">
        {sites.map((site) => {
          const rows: CategoryRow[] = categories
            .filter((c) => c.siteId === site.id)
            .map((c) => ({
              id: c.id,
              nameVi: c.names.vi ?? "",
              nameEn: c.names.en ?? "",
              slugVi: categorySlug(c, "vi"),
              slugEn: categorySlug(c, "en"),
              descriptionVi: c.descriptions.vi ?? "",
              descriptionEn: c.descriptions.en ?? "",
              posts: postCounts.get(c.id) ?? 0,
            }));
          return (
            <CategoryList
              key={site.id}
              site={{ id: site.id, name: site.name, baseUrl: site.baseUrl, blogPaths: site.blogPaths }}
              rows={rows}
            />
          );
        })}
      </div>
    </div>
  );
}
