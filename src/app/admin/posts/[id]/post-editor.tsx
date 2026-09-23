"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { JSONContent } from "@tiptap/react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CircleAlert,
  Clock3,
  ExternalLink,
  ImagePlus,
  Loader2,
  Lock,
  PanelRightClose,
  PanelRightOpen,
  Trash2,
  X,
} from "lucide-react";
import type { Locale, PostStatus, PostTranslation } from "@/db/schema";
import { fmt } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { STATUS, slugify } from "@/lib/posts";
import { imageFiles, uploadImage } from "@/lib/upload-client";
import { cn } from "@/lib/utils";
import { markTranslationSynced, restorePosts, savePost, trashPostAndLeave } from "../actions";
import { RichTextEditor } from "./rich-text-editor";

export type LocaleTab = { locale: Locale; status: PostStatus | null; stale: boolean };

type Props = {
  post: { id: string; categoryId: string | null; featured: boolean; coverImageUrl: string | null };
  locale: Locale;
  locales: LocaleTab[];
  translation: PostTranslation | null;
  /** Locale this translation was made from, when that source has changed since. */
  staleSource: Locale | null;
  site: { id: string; name: string; baseUrl: string; blogPath: string };
  categories: { id: string; name: string }[];
  canPublish: boolean;
  /** This language is live and the user may not change live articles. */
  locked: boolean;
  canDelete: boolean;
  /** Set while the article is in the trash: read-only until restored. */
  trashed: { at: Date; by: string | null } | null;
  /** Latest activity on this article, newest first. */
  history: { at: Date; who: string; summary: string }[];
};

const PLACEHOLDER_SLUG = /^bai-viet-[0-9a-f]{8}$/;

function toLocalInput(date: Date | null) {
  if (!date) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatTime(date: Date, dateLocale: string) {
  return new Intl.DateTimeFormat(dateLocale, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(
    date,
  );
}

function countWords(html: string) {
  return html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
}

/**
 * Date and reading time as the website prints them: in the article's language (`locale`), not the
 * interface language, so the header preview matches the published page.
 */
function formatDay(date: Date, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    day: "2-digit",
    month: locale === "vi" ? "2-digit" : "short",
    year: "numeric",
  }).format(date);
}

function readingLabel(minutes: number, locale: Locale) {
  return locale === "vi" ? `${minutes} phút đọc` : `${minutes} min read`;
}

/** Text of every level-2 heading: the sections of the article on the website. */
function sectionTitles(doc: JSONContent | null) {
  const text = (node: JSONContent): string => node.text ?? (node.content ?? []).map(text).join("");
  return (doc?.content ?? [])
    .filter((node) => node.type === "heading" && node.attrs?.level === 2)
    .map((node) => text(node).trim());
}

export function PostEditor({
  post,
  locale,
  locales,
  translation,
  staleSource,
  site,
  categories,
  canPublish,
  locked: lockedByRole,
  canDelete,
  trashed,
  history,
}: Props) {
  const router = useRouter();
  const { t } = useI18n();
  const time = (date: Date) => formatTime(date, t.common.dateLocale);
  const locked = lockedByRole || !!trashed;
  const [title, setTitle] = useState(translation?.title ?? "");
  const [excerpt, setExcerpt] = useState(translation?.excerpt ?? "");
  const [content, setContent] = useState<{ json: JSONContent | null; html: string }>({
    json: (translation?.contentJson as JSONContent | null) ?? null,
    html: translation?.contentHtml ?? "",
  });
  const [slug, setSlug] = useState(translation?.slug ?? "");
  // Follow the title until the slug is edited by hand or the article has been saved with a real one.
  const [slugTouched, setSlugTouched] = useState(!!translation && !PLACEHOLDER_SLUG.test(translation.slug));
  const [status, setStatus] = useState<PostStatus>(translation?.status ?? "draft");
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(translation?.scheduledAt ?? null));
  const [metaTitle, setMetaTitle] = useState(translation?.metaTitle ?? "");
  const [metaDescription, setMetaDescription] = useState(translation?.metaDescription ?? "");
  const [focusKeyword, setFocusKeyword] = useState(translation?.focusKeyword ?? "");
  const [noindex, setNoindex] = useState(translation?.noindex ?? false);
  const [categoryId, setCategoryId] = useState(post.categoryId ?? "");
  const [featured, setFeatured] = useState(post.featured);
  const [coverImageUrl, setCoverImageUrl] = useState(post.coverImageUrl ?? "");

  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(translation?.updatedAt ?? null);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, startSaving] = useTransition();
  const [syncing, startSyncing] = useTransition();
  const [deleting, startDeleting] = useTransition();
  const [restoring, startRestoring] = useTransition();

  /** Wraps a setter so any edit marks the form as unsaved. */
  function edit<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setDirty(true);
    };
  }

  const effectiveSlug = slugTouched ? slug : slugify(title);

  const save = useCallback(() => {
    setError(null);
    startSaving(async () => {
      const result = await savePost({
        postId: post.id,
        locale,
        status,
        title,
        slug: effectiveSlug,
        excerpt,
        contentJson: content.json,
        contentHtml: content.html,
        metaTitle,
        metaDescription,
        focusKeyword,
        noindex,
        scheduledAt: status === "scheduled" && scheduledAt ? new Date(scheduledAt).toISOString() : null,
        categoryId: categoryId || null,
        featured,
        coverImageUrl: coverImageUrl.trim(),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSlug(result.slug);
      setSlugTouched(true);
      setSavedAt(new Date(result.savedAt));
      setDirty(false);
    });
  }, [
    post.id,
    locale,
    status,
    title,
    effectiveSlug,
    excerpt,
    content,
    metaTitle,
    metaDescription,
    focusKeyword,
    noindex,
    scheduledAt,
    categoryId,
    featured,
    coverImageUrl,
  ]);

  // Ctrl/Cmd + S saves instead of downloading the page.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!locked) save();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save, locked]);

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function confirmLeave(event: React.MouseEvent) {
    if (dirty && !window.confirm(t.editor.confirmLeave)) event.preventDefault();
  }

  function togglePanel() {
    if (window.matchMedia("(min-width: 1024px)").matches) setPanelOpen((v) => !v);
    else setDrawerOpen((v) => !v);
  }

  const publicUrl = `${site.baseUrl}${site.blogPath}/${effectiveSlug}`;
  const words = countWords(content.html);
  const readingMinutes = Math.max(1, Math.round(words / 200));
  const categoryName = categories.find((c) => c.id === categoryId)?.name;
  const outline = sectionTitles(content.json);
  const isLiveOnSite = translation?.status === "published" && !dirty;
  // The hint names the toolbar button in bold: split the sentence around it.
  const [outlineEmptyBefore, outlineEmptyAfter = ""] = t.editor.panel.outlineEmpty.split("{h2}");

  return (
    <div className="flex h-dvh flex-col bg-white">
      {/* ---------- Top bar ---------- */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-200 px-3 sm:px-4">
        <Link
          href="/admin"
          onClick={confirmLeave}
          title={t.editor.header.back}
          className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="hidden min-w-0 sm:block">
          <p className="truncate text-sm font-medium">{title || t.editor.header.untitled}</p>
          <p className="text-xs text-zinc-500">{site.name}</p>
        </div>

        <nav className="ml-2 flex shrink-0 rounded-lg bg-zinc-100 p-0.5" aria-label={t.editor.header.languages}>
          {locales.map((tab) => (
            <Link
              key={tab.locale}
              href={`/admin/posts/${post.id}?locale=${tab.locale}`}
              onClick={confirmLeave}
              title={
                tab.status
                  ? fmt(t.editor.header.tab, { language: t.common.locales[tab.locale], status: t.common.status[tab.status] })
                  : fmt(t.editor.header.tabMissing, { language: t.common.locales[tab.locale] })
              }
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium",
                tab.locale === locale ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800",
              )}
            >
              {tab.locale.toUpperCase()}
              {!tab.status && <span className="size-1.5 rounded-full border border-zinc-400" />}
              {tab.stale && <AlertTriangle className="size-3 text-amber-500" aria-label={t.editor.header.needsUpdate} />}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-xs text-zinc-500 md:flex" suppressHydrationWarning>
            {saving ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> {t.editor.header.saving}
              </>
            ) : dirty ? (
              <>
                <span className="size-1.5 rounded-full bg-amber-500" /> {t.editor.header.unsaved}
              </>
            ) : savedAt ? (
              <>
                <Check className="size-3.5 text-emerald-600" /> {fmt(t.editor.header.savedAt, { time: time(savedAt) })}
              </>
            ) : null}
          </span>
          <span className={cn("hidden rounded-full px-2.5 py-1 text-xs font-medium sm:inline", STATUS[status].className)}>
            {t.common.status[status]}
          </span>
          {isLiveOnSite && (
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={t.editor.header.viewOnSiteTitle}
              className="hidden items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 hover:border-brand-light hover:text-brand lg:inline-flex"
            >
              <ExternalLink className="size-4" />
              {t.editor.header.viewOnSite}
            </a>
          )}
          <button
            type="button"
            onClick={togglePanel}
            title={t.editor.header.settings}
            className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
          >
            {panelOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || locked}
            title={t.editor.header.saveTitle}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t.common.save}
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* ---------- Writing canvas ---------- */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          {/* The editor toolbar is portalled here so it spans the column and stays on one line. */}
          <div id="editor-toolbar" className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur empty:hidden" />
          <div className="mx-auto max-w-3xl px-5 pb-40 pt-8 sm:px-10">
            <div className="flex flex-col gap-3">
              {trashed && (
                <Notice tone="warning" icon={Trash2}>
                  <span className="flex-1" suppressHydrationWarning>
                    {trashed.by
                      ? fmt(t.editor.notices.trashedBy, { name: trashed.by, time: time(trashed.at) })
                      : fmt(t.editor.notices.trashed, { time: time(trashed.at) })}
                  </span>
                  {canDelete && (
                    <button
                      type="button"
                      disabled={restoring}
                      onClick={() =>
                        startRestoring(async () => {
                          await restorePosts([post.id]);
                          router.refresh();
                        })
                      }
                      className="shrink-0 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold hover:bg-amber-100 disabled:opacity-60"
                    >
                      {t.editor.notices.restore}
                    </button>
                  )}
                </Notice>
              )}
              {lockedByRole && !trashed && (
                <Notice tone="neutral" icon={Lock}>
                  {fmt(t.editor.notices.locked, { status: t.common.status.in_review })}
                </Notice>
              )}
              {staleSource && (
                <Notice tone="warning" icon={AlertTriangle}>
                  <span className="flex-1">
                    {fmt(t.editor.notices.stale, { language: t.common.locales[staleSource] })}
                  </span>
                  <button
                    type="button"
                    disabled={syncing || locked}
                    onClick={() => startSyncing(() => markTranslationSynced(post.id, locale))}
                    className="shrink-0 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-amber-100 disabled:opacity-60"
                  >
                    {t.editor.notices.markSynced}
                  </button>
                </Notice>
              )}
              {!translation && (
                <Notice tone="info">
                  {fmt(t.editor.notices.missing, { language: t.common.locales[locale] })}
                </Notice>
              )}
            </div>

            {/* Same order and look as the article header on the website. */}
            <div className="mt-8 flex flex-wrap items-center gap-3 text-xs font-bold text-[#5f6368]">
              <span className="rounded-full bg-brand-tint px-3 py-1.5 text-brand">{categoryName ?? t.editor.canvas.uncategorized}</span>
              <span suppressHydrationWarning>{formatDay(translation?.publishedAt ?? new Date(), locale)}</span>
              <span aria-hidden>•</span>
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="size-3.5" />
                {readingLabel(readingMinutes, locale)}
              </span>
            </div>
            <textarea
              value={title}
              onChange={(e) => edit(setTitle)(e.target.value.replace(/\n/g, ""))}
              // In the article's language, like the header preview above.
              placeholder={locale === "vi" ? "Tiêu đề bài viết" : "Article title"}
              rows={1}
              disabled={locked}
              className="mt-5 w-full resize-none overflow-hidden bg-transparent text-4xl font-extrabold leading-[1.16] tracking-[-0.035em] text-ink outline-none field-sizing-content placeholder:text-zinc-300 disabled:bg-transparent sm:text-[3.25rem]"
            />
            <textarea
              value={excerpt}
              onChange={(e) => edit(setExcerpt)(e.target.value)}
              placeholder={t.editor.canvas.excerptPlaceholder}
              rows={1}
              disabled={locked}
              className="mt-5 w-full resize-none overflow-hidden bg-transparent text-lg leading-8 text-ink-soft outline-none field-sizing-content placeholder:text-zinc-300 disabled:bg-transparent sm:text-xl"
            />

            <CoverImage
              url={coverImageUrl}
              siteId={site.id}
              disabled={locked}
              onChange={edit(setCoverImageUrl)}
              onError={setError}
            />
            <hr className="my-8 border-line" />

            <RichTextEditor
              content={content.json}
              onChange={edit(setContent)}
              siteId={site.id}
              onError={setError}
              editable={!locked}
            />
          </div>
        </main>

        {/* ---------- Settings panel ---------- */}
        {drawerOpen && (
          <div className="fixed inset-0 z-30 bg-ink/30 lg:hidden" onClick={() => setDrawerOpen(false)} aria-hidden />
        )}
        <aside
          className={cn(
            "w-[340px] shrink-0 overflow-y-auto border-l border-zinc-200 bg-zinc-50",
            "max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:max-w-[90vw] max-lg:shadow-2xl",
            drawerOpen ? "max-lg:block" : "max-lg:hidden",
            panelOpen ? "lg:block" : "lg:hidden",
          )}
        >
          <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 lg:hidden">
            <span className="text-sm font-semibold">{t.editor.header.settings}</span>
            <button type="button" onClick={() => setDrawerOpen(false)} className="rounded-md p-1.5 hover:bg-zinc-200">
              <X className="size-4" />
            </button>
          </div>
          <fieldset disabled={locked} className="min-w-0 divide-y divide-zinc-200">
            <Section title={t.editor.panel.outline} hint={t.editor.panel.outlineHint}>
              {outline.length > 0 ? (
                <ol className="space-y-1 border-l-2 border-line pl-3 text-sm">
                  {outline.map((heading, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => document.querySelectorAll(".tiptap h2")[i]?.scrollIntoView({ behavior: "smooth", block: "start" })}
                        className="text-left leading-6 text-zinc-600 hover:text-brand"
                      >
                        {heading || t.editor.panel.emptyHeading}
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="rounded-lg border border-dashed border-zinc-300 bg-white px-3 py-2.5 text-xs leading-relaxed text-zinc-500">
                  {outlineEmptyBefore}
                  <strong className="font-semibold">H2</strong>
                  {outlineEmptyAfter}
                </p>
              )}
            </Section>
            <Section title={t.editor.panel.publish}>
              <Field label={t.editor.panel.status}>
                <select value={status} onChange={(e) => edit(setStatus)(e.target.value as PostStatus)} className={inputClass}>
                  {(Object.keys(STATUS) as PostStatus[]).map((s) => (
                    <option key={s} value={s} disabled={!canPublish && (s === "published" || s === "scheduled")}>
                      {t.common.status[s]}
                    </option>
                  ))}
                </select>
              </Field>
              {status === "scheduled" && (
                <Field label={t.editor.panel.publishAt}>
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => edit(setScheduledAt)(e.target.value)}
                    className={inputClass}
                    suppressHydrationWarning
                  />
                </Field>
              )}
              {!canPublish && (
                <p className="text-xs leading-relaxed text-zinc-500">
                  {fmt(t.editor.panel.writerHint, { status: t.common.status.in_review })}
                </p>
              )}
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <Stat label={t.editor.panel.words} value={words.toLocaleString(t.common.dateLocale)} />
                <Stat label={t.editor.panel.readingTime} value={fmt(t.editor.panel.readingMinutes, { n: readingMinutes })} />
                {translation?.publishedAt && (
                  <div className="col-span-2">
                    <Stat label={t.editor.panel.firstPublished} value={time(translation.publishedAt)} />
                  </div>
                )}
              </dl>
            </Section>

            <Section title={t.editor.panel.link}>
              <Field label={t.editor.panel.slug}>
                <input
                  value={effectiveSlug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    edit(setSlug)(e.target.value);
                  }}
                  onBlur={() => setSlug(slugify(slug))}
                  className={cn(inputClass, "font-mono text-xs")}
                />
              </Field>
              <p className="break-all text-xs text-zinc-500">{publicUrl}</p>
            </Section>

            <Section title={t.editor.panel.taxonomy} hint={t.editor.panel.taxonomyHint}>
              <Field label={t.editor.panel.category}>
                <select value={categoryId} onChange={(e) => edit(setCategoryId)(e.target.value)} className={inputClass}>
                  <option value="">{t.editor.canvas.uncategorized}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Toggle
                checked={featured}
                onChange={edit(setFeatured)}
                label={t.editor.panel.featured}
                hint={t.editor.panel.featuredHint}
              />
            </Section>

            <SeoSection
              title={title}
              excerpt={excerpt}
              html={content.html}
              slug={effectiveSlug}
              publicUrl={publicUrl}
              metaTitle={metaTitle}
              metaDescription={metaDescription}
              focusKeyword={focusKeyword}
              noindex={noindex}
              onMetaTitle={edit(setMetaTitle)}
              onMetaDescription={edit(setMetaDescription)}
              onFocusKeyword={edit(setFocusKeyword)}
              onNoindex={edit(setNoindex)}
            />
          </fieldset>

          <div className="border-t border-zinc-200">
          <Section title={t.activity.historyTitle} hint={t.activity.historyHint}>
            {history.length === 0 ? (
              <p className="text-xs text-zinc-500">{t.activity.historyEmpty}</p>
            ) : (
              <ol className="relative space-y-3 border-l border-zinc-200 pl-4">
                {history.map((h, i) => (
                  <li key={i} className="relative text-xs">
                    <span className="absolute -left-[1.3rem] top-1 size-2 rounded-full border-2 border-white bg-brand-bright" />
                    <p className="font-medium text-zinc-800">{h.summary}</p>
                    <p className="text-zinc-500" suppressHydrationWarning>
                      {h.who} · {time(h.at)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Section>
          </div>

          {canDelete && !trashed && (
            <div className="border-t border-zinc-200 px-5 py-5">
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  if (!window.confirm(t.editor.panel.confirmTrash)) return;
                  setDirty(false);
                  startDeleting(() => trashPostAndLeave(post.id));
                }}
                className="inline-flex items-center gap-1.5 text-sm text-red-600 hover:text-red-800 disabled:opacity-60"
              >
                <Trash2 className="size-4" />
                {t.editor.panel.trash}
              </button>
            </div>
          )}
        </aside>
      </div>

      {error && (
        <div
          role="alert"
          className="fixed bottom-6 left-1/2 z-50 flex w-[min(92vw,32rem)] -translate-x-1/2 items-start gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-2xl"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-400" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label={t.common.close} className="text-zinc-400 hover:text-white">
            <X className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- Pieces ---------- */

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-bright focus:ring-2 focus:ring-brand-bright/20 disabled:bg-zinc-100";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 px-5 py-5">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</h2>
        {hint && <p className="mt-1 text-xs text-zinc-400">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-700">
      <span className="flex items-center justify-between">
        {label}
        {hint}
      </span>
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-zinc-800" suppressHydrationWarning>
        {value}
      </dd>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="relative flex cursor-pointer items-start justify-between gap-3">
      <span>
        <span className="block text-sm font-medium text-zinc-700">{label}</span>
        {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-zinc-300 transition peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand-bright/40 after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-4" />
    </label>
  );
}

function Notice({
  tone,
  icon: Icon,
  children,
}: {
  tone: "info" | "warning" | "neutral";
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm",
        tone === "info" && "border-sky-200 bg-sky-50 text-sky-800",
        tone === "warning" && "border-amber-200 bg-amber-50 text-amber-800",
        tone === "neutral" && "border-zinc-200 bg-zinc-50 text-zinc-700",
      )}
    >
      {Icon && <Icon className="size-4 shrink-0" />}
      {children}
    </div>
  );
}

/** Wide cover picture above the title; upload by clicking or dropping a file. */
function CoverImage({
  url,
  siteId,
  disabled,
  onChange,
  onError,
}: {
  url: string;
  siteId: string;
  disabled: boolean;
  onChange: (url: string) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      onChange((await uploadImage(file, { siteId, networkError: t.editor.upload.network })).url);
    } catch (error) {
      onError(error instanceof Error ? error.message : t.editor.cover.failed);
    } finally {
      setUploading(false);
    }
  }

  const dropProps = disabled
    ? {}
    : {
        onDragOver: (e: React.DragEvent) => {
          e.preventDefault();
          setDragOver(true);
        },
        onDragLeave: () => setDragOver(false),
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          setDragOver(false);
          void upload(imageFiles(e.dataTransfer.files)[0]);
        },
      };

  return (
    <div className="mt-6" {...dropProps}>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        hidden
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {url ? (
        <div className="group relative overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
          {/* eslint-disable-next-line @next/next/no-img-element -- uploaded or external URL */}
          <img src={url} alt={t.editor.cover.alt} className="aspect-[2/1] w-full object-cover" />
          {!disabled && (
            <div className="absolute right-3 top-3 flex gap-2 opacity-0 transition group-hover:opacity-100">
              <button
                type="button"
                onClick={() => input.current?.click()}
                className="rounded-lg bg-white/95 px-3 py-1.5 text-xs font-medium shadow hover:bg-white"
              >
                {t.editor.cover.change}
              </button>
              <button
                type="button"
                onClick={() => onChange("")}
                className="rounded-lg bg-white/95 px-3 py-1.5 text-xs font-medium text-red-600 shadow hover:bg-white"
              >
                {t.editor.cover.remove}
              </button>
            </div>
          )}
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70">
              <Loader2 className="size-6 animate-spin text-zinc-500" />
            </div>
          )}
        </div>
      ) : (
        !disabled && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-700",
              dragOver ? "border-brand-bright bg-brand-soft text-brand" : "border-zinc-300",
            )}
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
            {uploading ? t.editor.cover.uploading : t.editor.cover.add}
          </button>
        )
      )}
    </div>
  );
}

function includes(text: string, keyword: string) {
  return text.toLowerCase().includes(keyword.trim().toLowerCase());
}

function SeoSection(props: {
  title: string;
  excerpt: string;
  html: string;
  slug: string;
  publicUrl: string;
  metaTitle: string;
  metaDescription: string;
  focusKeyword: string;
  noindex: boolean;
  onMetaTitle: (v: string) => void;
  onMetaDescription: (v: string) => void;
  onFocusKeyword: (v: string) => void;
  onNoindex: (v: boolean) => void;
}) {
  const { t } = useI18n();
  const seo = t.editor.seo;
  const seoTitle = props.metaTitle || props.title;
  const seoDescription = props.metaDescription || props.excerpt;
  const keyword = props.focusKeyword.trim();
  const checks = keyword
    ? [
        { ok: includes(seoTitle, keyword), label: seo.checkTitle },
        { ok: includes(seoDescription, keyword), label: seo.checkDescription },
        { ok: props.slug.includes(slugify(keyword)), label: seo.checkSlug },
        { ok: includes(props.html, keyword), label: seo.checkContent },
        { ok: seoTitle.length > 0 && seoTitle.length <= 60, label: seo.checkTitleLength },
        { ok: seoDescription.length >= 50 && seoDescription.length <= 160, label: seo.checkDescriptionLength },
      ]
    : [];
  const passed = checks.filter((c) => c.ok).length;

  return (
    <Section title={seo.title}>
      <div className="rounded-lg border border-zinc-200 bg-white p-3">
        <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">{seo.preview}</p>
        <p className="mt-2 truncate text-xs text-zinc-600">{props.publicUrl}</p>
        <p className="mt-0.5 line-clamp-2 text-[15px] leading-snug text-[#1a0dab]">{seoTitle || seo.previewTitle}</p>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-600">
          {seoDescription || seo.previewDescription}
        </p>
      </div>
      <Field label={seo.metaTitle} hint={<Counter value={seoTitle} max={60} />}>
        <input
          value={props.metaTitle}
          onChange={(e) => props.onMetaTitle(e.target.value)}
          placeholder={props.title || seo.metaTitlePlaceholder}
          className={inputClass}
        />
      </Field>
      <Field label={seo.metaDescription} hint={<Counter value={seoDescription} max={160} />}>
        <textarea
          value={props.metaDescription}
          onChange={(e) => props.onMetaDescription(e.target.value)}
          placeholder={props.excerpt || seo.metaDescriptionPlaceholder}
          rows={3}
          className={cn(inputClass, "resize-none")}
        />
      </Field>
      <Field label={seo.focusKeyword}>
        <input
          value={props.focusKeyword}
          onChange={(e) => props.onFocusKeyword(e.target.value)}
          placeholder={seo.focusKeywordPlaceholder}
          className={inputClass}
        />
      </Field>
      {checks.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          <p className="mb-2 flex items-center justify-between text-xs font-medium text-zinc-700">
            {seo.checks}
            <span className={cn(passed === checks.length ? "text-emerald-600" : "text-amber-600")}>
              {passed}/{checks.length}
            </span>
          </p>
          <ul className="flex flex-col gap-1.5 text-xs">
            {checks.map((c) => (
              <li key={c.label} className={cn("flex items-center gap-2", c.ok ? "text-zinc-700" : "text-zinc-400")}>
                {c.ok ? <Check className="size-3.5 text-emerald-600" /> : <X className="size-3.5 text-zinc-300" />}
                {c.label}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Toggle
        checked={props.noindex}
        onChange={props.onNoindex}
        label={seo.noindex}
        hint={seo.noindexHint}
      />
    </Section>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  return (
    <span className={cn("text-xs font-normal", value.length > max ? "text-red-600" : "text-zinc-400")}>
      {value.length}/{max}
    </span>
  );
}
