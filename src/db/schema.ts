import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { ContentBrief } from "@/lib/ai-brief";

export const roleEnum = pgEnum("role", ["admin", "editor", "writer"]);
export const localeEnum = pgEnum("locale", ["vi", "en"]);
export const statusEnum = pgEnum("post_status", [
  "draft",
  "in_review",
  "scheduled",
  "published",
  "archived",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** A website the CMS publishes to (qubx, coauths). */
export const sites = pgTable("sites", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Public origin without trailing slash, e.g. https://www.qub-x.com */
  baseUrl: text("base_url").notNull(),
  /** Blog path per locale, e.g. {"en":"/blog","vi":"/vi/blog"} */
  blogPaths: jsonb("blog_paths").$type<Record<Locale, string>>().notNull(),
  defaultLocale: localeEnum("default_locale").notNull().default("vi"),
  /** Endpoint on the website that refreshes its cache when a post changes. */
  revalidateUrl: text("revalidate_url"),
  /**
   * What the blog is for, written once by the team: who reads it, what it leads to, its voice and what
   * it avoids. Shown on the content overview and given to the AI with every prompt (lib/ai-brief).
   */
  contentBrief: jsonb("content_brief").$type<ContentBrief>().notNull().default({}),
  /** How many articles the team means to publish a week; null until set. */
  postsPerWeek: integer("posts_per_week"),
  ...timestamps,
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("writer"),
  active: boolean("active").notNull().default(true),
  /**
   * Public author profile per locale, shown with the articles this person wrote. Left empty, the
   * person's name is never published and their articles are credited to the website.
   */
  jobTitles: jsonb("job_titles").$type<Partial<Record<Locale, string>>>().notNull().default({}),
  bios: jsonb("bios").$type<Partial<Record<Locale, string>>>().notNull().default({}),
  ...timestamps,
});

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the cookie token; the raw token never touches the database. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    /** Display name per locale, e.g. {"vi":"Vận hành","en":"Operations"} */
    names: jsonb("names").$type<Partial<Record<Locale, string>>>().notNull(),
    /** URL segment of the category's page per locale; a missing one derives from the name (lib/categories). */
    slugs: jsonb("slugs").$type<Partial<Record<Locale, string>>>().notNull().default({}),
    /** Short introduction per locale, shown on the category's page. */
    descriptions: jsonb("descriptions").$type<Partial<Record<Locale, string>>>().notNull().default({}),
    /** Order in lists and filters, lowest first. */
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("categories_site_idx").on(t.siteId)],
);

/** Language-independent part of an article. Each language lives in post_translations. */
export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    coverImageUrl: text("cover_image_url"),
    featured: boolean("featured").notNull().default(false),
    /** The overview article of its category (topic), which the other articles of the topic link to. */
    pillar: boolean("pillar").notNull().default(false),
    /**
     * The day the team means to publish it (YYYY-MM-DD), placing a draft on the editorial calendar.
     * A plan only: publishing still happens by hand or through scheduledAt.
     */
    plannedFor: date("planned_for", { mode: "string" }),
    /** Who looks after the article until it is published, usually the editor reviewing it. */
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    /** Set when moved to the trash; the article is hidden everywhere until restored. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("posts_site_idx").on(t.siteId),
    index("posts_deleted_idx").on(t.deletedAt),
    index("posts_assignee_idx").on(t.assigneeId),
  ],
);

export const postTranslations = pgTable(
  "post_translations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    /** Copied from posts so slugs can be unique per site and locale. */
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    locale: localeEnum("locale").notNull(),
    status: statusEnum("status").notNull().default("draft"),

    title: text("title").notNull().default(""),
    slug: text("slug").notNull(),
    excerpt: text("excerpt").notNull().default(""),
    /** Tiptap document JSON — the editable source. */
    contentJson: jsonb("content_json"),
    /** Rendered HTML served to the websites. */
    contentHtml: text("content_html").notNull().default(""),
    readingMinutes: integer("reading_minutes").notNull().default(1),

    metaTitle: text("meta_title").notNull().default(""),
    metaDescription: text("meta_description").notNull().default(""),
    focusKeyword: text("focus_keyword").notNull().default(""),
    ogImageUrl: text("og_image_url"),
    /** Describes the article's cover image (shared by every language) in this language, for screen readers and search. */
    coverImageAlt: text("cover_image_alt").notNull().default(""),
    canonicalUrl: text("canonical_url"),
    noindex: boolean("noindex").notNull().default(false),

    /** Hash of title + excerpt + content, used to detect a stale translation. */
    contentHash: text("content_hash").notNull().default(""),
    /** When this version was translated from another locale: that locale and its hash at the time. */
    translatedFromLocale: localeEnum("translated_from_locale"),
    translatedFromHash: text("translated_from_hash"),

    publishedAt: timestamp("published_at", { withTimezone: true }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("post_translations_post_locale_uq").on(t.postId, t.locale),
    uniqueIndex("post_translations_site_locale_slug_uq").on(t.siteId, t.locale, t.slug),
    index("post_translations_public_idx")
      .on(t.siteId, t.locale, t.publishedAt)
      .where(sql`${t.status} = 'published'`),
  ],
);

export const revisions = pgTable(
  "revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    translationId: uuid("translation_id")
      .notNull()
      .references(() => postTranslations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    excerpt: text("excerpt").notNull(),
    contentJson: jsonb("content_json"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("revisions_translation_idx").on(t.translationId)],
);

export const media = pgTable("media", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: text("site_id").references(() => sites.id, { onDelete: "set null" }),
  url: text("url").notNull(),
  storageKey: text("storage_key").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  alt: text("alt").notNull().default(""),
  uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Failed sign-ins, kept briefly to slow down password guessing. */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    ip: text("ip").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempts_email_idx").on(t.email, t.createdAt), index("login_attempts_ip_idx").on(t.ip, t.createdAt)],
);

/** Slugs an article was published under before being renamed, so old links keep working. */
export const slugRedirects = pgTable(
  "slug_redirects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    locale: localeEnum("locale").notNull(),
    fromSlug: text("from_slug").notNull(),
    translationId: uuid("translation_id")
      .notNull()
      .references(() => postTranslations.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("slug_redirects_from_uq").on(t.siteId, t.locale, t.fromSlug)],
);

/** Who did what and when: articles, accounts, settings and sign-ins. */
export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** Null for things the system did on its own, such as publishing a scheduled article. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** e.g. post.published, user.locked, site.updated, auth.login */
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    siteId: text("site_id"),
    /** Human-readable line shown in the log, in Vietnamese. */
    summary: text("summary").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("activity_log_at_idx").on(t.at),
    index("activity_log_entity_idx").on(t.entityType, t.entityId, t.at),
    index("activity_log_user_idx").on(t.userId, t.at),
  ],
);

/** Fixed terms the AI translator must respect, e.g. "liệu trình" → "treatment plan". */
export const glossary = pgTable(
  "glossary",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    vi: text("vi").notNull(),
    en: text("en").notNull(),
    note: text("note").notNull().default(""),
    ...timestamps,
  },
  (t) => [index("glossary_site_idx").on(t.siteId)],
);

export const postsRelations = relations(posts, ({ one, many }) => ({
  site: one(sites, { fields: [posts.siteId], references: [sites.id] }),
  category: one(categories, { fields: [posts.categoryId], references: [categories.id] }),
  author: one(users, { fields: [posts.authorId], references: [users.id], relationName: "author" }),
  assignee: one(users, { fields: [posts.assigneeId], references: [users.id], relationName: "assignee" }),
  translations: many(postTranslations),
}));

export const postTranslationsRelations = relations(postTranslations, ({ one, many }) => ({
  post: one(posts, { fields: [postTranslations.postId], references: [posts.id] }),
  editor: one(users, { fields: [postTranslations.updatedBy], references: [users.id] }),
  revisions: many(revisions),
}));

export const revisionsRelations = relations(revisions, ({ one }) => ({
  translation: one(postTranslations, {
    fields: [revisions.translationId],
    references: [postTranslations.id],
  }),
  author: one(users, { fields: [revisions.createdBy], references: [users.id] }),
}));

export const categoriesRelations = relations(categories, ({ one }) => ({
  site: one(sites, { fields: [categories.siteId], references: [sites.id] }),
}));

export type Locale = (typeof localeEnum.enumValues)[number];
export type Role = (typeof roleEnum.enumValues)[number];
export type PostStatus = (typeof statusEnum.enumValues)[number];
export type User = typeof users.$inferSelect;
export type Site = typeof sites.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type PostTranslation = typeof postTranslations.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Media = typeof media.$inferSelect;
export type Activity = typeof activityLog.$inferSelect;
