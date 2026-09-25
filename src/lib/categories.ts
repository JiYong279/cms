import type { Category, Locale } from "@/db/schema";
import { slugify } from "./posts";

type Named = Pick<Category, "names" | "slugs">;

/** The category's name in `locale`, falling back to the other language. */
export function categoryName(category: Pick<Category, "names">, locale: Locale) {
  return category.names[locale] || category.names.vi || category.names.en || "";
}

/** The category page's URL segment in `locale`: the saved one, or one derived from the name. */
export function categorySlug(category: Named, locale: Locale) {
  return category.slugs[locale] || slugify(categoryName(category, locale));
}
