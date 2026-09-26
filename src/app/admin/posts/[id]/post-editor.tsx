"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { JSONContent } from "@tiptap/react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  Copy,
  Clock3,
  ExternalLink,
  ImagePlus,
  Languages,
  Loader2,
  Lock,
  PanelRightClose,
  PanelRightOpen,
  PenLine,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { ConfirmPopover } from "@/components/confirm-popover";
import { useReturnTo } from "@/components/return-to";
import type { Locale, PostStatus, PostTranslation } from "@/db/schema";
import { fmt } from "@/i18n";
import { useI18n } from "@/i18n/client";
import type { ArticleFields, DraftLength } from "@/lib/ai";
import { draftPrompt, parsePastedArticle, translatePrompt } from "@/lib/ai-paste";
import { STATUS, slugify } from "@/lib/posts";
import { SCORE_THRESHOLDS, scoreArticle, type CheckId, type ScoreCheck, type ScoreResult } from "@/lib/seo-score";
import { imageFiles, uploadImage } from "@/lib/upload-client";
import { cn } from "@/lib/utils";
import { markTranslationSynced, restorePosts, savePost, trashPostAndLeave } from "../actions";
import { aiDraft, aiSourceArticle, aiTranslate } from "../ai-actions";
import { RichTextEditor } from "./rich-text-editor";
import { Field, Section, inputClass } from "./editor/panel";
import { PlanningFields } from "./editor/planning-fields";

export type LocaleTab = { locale: Locale; status: PostStatus | null; stale: boolean };

type Props = {
  post: { id: string; categoryId: string | null; featured: boolean; coverImageUrl: string | null };
  locale: Locale;
  locales: LocaleTab[];
  translation: PostTranslation | null;
  /** Locale this translation was made from, when that source has changed since. */
  staleSource: Locale | null;
  /** `viewOrigin` is where to open the article to look at it (see viewOrigin in lib/posts). */
  site: { id: string; name: string; baseUrl: string; viewOrigin: string; blogPath: string };
  categories: { id: string; name: string }[];
  /** The editorial calendar's plan for the article (saved on its own, see PlanningFields). */
  planning: { plannedFor: string | null; assigneeId: string | null; assignees: { id: string; name: string }[]; canAssign: boolean };
  canPublish: boolean;
  /** This language is live and the user may not change live articles. */
  locked: boolean;
  canDelete: boolean;
  /** Set while the article is in the trash: read-only until restored. */
  trashed: { at: Date; by: string | null } | null;
  /** Latest activity on this article, newest first. */
  history: { at: Date; who: string; summary: string }[];
  /** ANTHROPIC_API_KEY is set, so the AI assistant can run. */
  aiEnabled: boolean;
  /** Opened from the other language's "translate into this one": start with the AI dialog translating. */
  openAi: "translate" | null;
  aiEngine: "own" | "builtin" | null;
  /** The article's author has a public profile in this language (see the Account page). */
  authorHasProfile: boolean;
  /** The viewer's zone (getTimeZone), so dates read the same when rendered on the server and in the browser. */
  timeZone: string;
};

const PLACEHOLDER_SLUG = /^bai-viet-[0-9a-f]{8}$/;

function toLocalInput(date: Date | null) {
  if (!date) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatTime(date: Date, dateLocale: string, timeZone: string) {
  return new Intl.DateTimeFormat(dateLocale, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", timeZone }).format(
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
function formatDay(date: Date, locale: Locale, timeZone: string) {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    day: "2-digit",
    month: locale === "vi" ? "2-digit" : "short",
    year: "numeric",
    timeZone,
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
  planning,
  canPublish,
  locked: lockedByRole,
  canDelete,
  trashed,
  history,
  aiEnabled,
  authorHasProfile,
  timeZone,
  openAi,
  aiEngine,
}: Props) {
  const router = useRouter();
  const { t } = useI18n();
  const time = (date: Date) => formatTime(date, t.common.dateLocale, timeZone);
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
  const [publishedAt, setPublishedAt] = useState(toLocalInput(translation?.publishedAt ?? null));
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
  const [notice, setNotice] = useState<{ text: string; href?: string } | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(openAi === "translate");
  // Where to go once the save in progress succeeds (translating this version into the other language).
  const afterSave = useRef<string | null>(null);
  // Back to the list, calendar or log (with its filters) the article was opened from.
  const backHref = useReturnTo("/admin");
  const [replacement, setReplacement] = useState<{ html: string; version: number } | null>(null);
  // The locale the current content was machine-translated from, until it is saved.
  const [translatedFrom, setTranslatedFrom] = useState<Locale | null>(null);
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

  /** Saves the form; `next` also moves the article to that status (the header's publish buttons). */
  const save = useCallback((next?: { status: PostStatus; scheduledAt?: string }) => {
    const nextStatus = next?.status ?? status;
    const nextSchedule = next?.scheduledAt ?? scheduledAt;
    setError(null);
    setNotice(null);
    startSaving(async () => {
      const result = await savePost({
        postId: post.id,
        locale,
        status: nextStatus,
        title,
        slug: effectiveSlug,
        excerpt,
        contentJson: content.json,
        contentHtml: content.html,
        metaTitle,
        metaDescription,
        focusKeyword,
        noindex,
        scheduledAt: nextStatus === "scheduled" && nextSchedule ? new Date(nextSchedule).toISOString() : null,
        publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null,
        categoryId: categoryId || null,
        featured,
        coverImageUrl: coverImageUrl.trim(),
        translatedFrom,
      });
      if (!result.ok) {
        afterSave.current = null;
        setError(result.error);
        return;
      }
      setSlug(result.slug);
      setSlugTouched(true);
      setSavedAt(new Date(result.savedAt));
      setDirty(false);
      setTranslatedFrom(null);
      if (afterSave.current) {
        router.push(afterSave.current);
        afterSave.current = null;
        return;
      }
      if (!next) return;
      setStatus(nextStatus);
      setScheduledAt(nextSchedule);
      const p = t.editor.publishing;
      if (nextStatus === "published") {
        setNotice({ text: fmt(p.published, { site: site.name }), href: `${site.viewOrigin}${site.blogPath}/${result.slug}` });
      } else if (nextStatus === "scheduled") {
        setNotice({ text: fmt(p.scheduled, { time: time(new Date(nextSchedule)) }) });
      } else {
        setNotice({ text: p.submitted });
      }
    });
  }, [
    t,
    router,
    site.name,
    site.viewOrigin,
    site.blogPath,
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
    publishedAt,
    categoryId,
    featured,
    coverImageUrl,
    translatedFrom,
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

  // The ?ai= and ?engine= that opened the dialog have done their job; a reload should not reopen it.
  useEffect(() => {
    if (!openAi) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("ai");
    url.searchParams.delete("engine");
    window.history.replaceState(window.history.state, "", url);
  }, [openAi]);

  /** Translates this version into the other language: saves it first when needed, then opens that one. */
  function translateOut(target: Locale, engine: "own" | "builtin") {
    const url = `/admin/posts/${post.id}?locale=${target}&ai=translate&engine=${engine}`;
    setAiOpen(false);
    if (dirty) {
      afterSave.current = url;
      save();
    } else {
      router.push(url);
    }
  }

  function confirmLeave(event: React.MouseEvent) {
    if (dirty && !window.confirm(t.editor.confirmLeave)) event.preventDefault();
  }

  /**
   * Brings a field into view and focuses it, opening the side panel (a drawer on small screens)
   * when the field lives there, and flashes it so the eye finds it.
   */
  function goTo(targetId: string) {
    const target = document.getElementById(targetId);
    if (!target) return;
    if (target.closest("aside")) {
      if (window.matchMedia("(min-width: 1024px)").matches) setPanelOpen(true);
      else setDrawerOpen(true);
    }
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      const focusable = (target.matches("input, textarea, select") ? target : target.querySelector(".ProseMirror, input, textarea, button")) as HTMLElement | null;
      focusable?.focus({ preventScroll: true });
      target.animate(
        [{ boxShadow: "0 0 0 4px rgb(32 181 110 / 0.45)", borderRadius: "10px" }, { boxShadow: "0 0 0 4px rgb(32 181 110 / 0)", borderRadius: "10px" }],
        { duration: 1600, easing: "ease-out" },
      );
    });
  }

  function goToCheck(id: CheckId) {
    // An image still missing its description: select it, which opens its description box.
    if (id === "imagesAlt") {
      const image = document.querySelector<HTMLElement>('.ProseMirror img:not([alt]), .ProseMirror img[alt=""]');
      if (image) {
        image.scrollIntoView({ behavior: "smooth", block: "center" });
        image.click();
        return;
      }
    }
    const field = CHECK_TARGET[id];
    if (field) goTo(field);
  }

  function togglePanel() {
    if (window.matchMedia("(min-width: 1024px)").matches) setPanelOpen((v) => !v);
    else setDrawerOpen((v) => !v);
  }

  const publicUrl = `${site.baseUrl}${site.blogPath}/${effectiveSlug}`;
  const viewUrl = `${site.viewOrigin}${site.blogPath}/${effectiveSlug}`;
  const words = countWords(content.html);
  const readingMinutes = Math.max(1, Math.round(words / 200));
  const categoryName = categories.find((c) => c.id === categoryId)?.name;
  const outline = sectionTitles(content.json);
  const isLiveOnSite = translation?.status === "published" && !dirty;
  // Once live (or scheduled), saving is the one action; before that, publishing is.
  const isLive = translation?.status === "published" || translation?.status === "scheduled";
  const primaryIsSave = isLive || (!canPublish && translation?.status === "in_review");
  const otherVersion = locales.find((tab) => tab.locale !== locale);
  const seoScore = scoreArticle({
    title,
    metaTitle,
    excerpt,
    metaDescription,
    focusKeyword,
    slug: effectiveSlug,
    html: content.html,
    categoryId: categoryId || null,
    coverImageUrl: coverImageUrl.trim() || null,
    authorHasProfile,
    translationInSync: !!otherVersion?.status && !otherVersion.stale && !locales.find((tab) => tab.locale === locale)?.stale,
    siteHost: new URL(site.baseUrl).host,
  });
  const otherUnpublished = locales.filter((tab) => tab.locale !== locale && tab.status !== "published");
  // The hint names the toolbar button in bold: split the sentence around it.
  const [outlineEmptyBefore, outlineEmptyAfter = ""] = t.editor.panel.outlineEmpty.split("{h2}");

  return (
    <div className="flex h-dvh flex-col bg-white">
      {/* ---------- Top bar ---------- */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-200 px-3 sm:px-4">
        <Link
          href={backHref}
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
          <button
            type="button"
            onClick={() => goTo("seo-score")}
            title={t.editor.score.badgeTitle}
            data-seo-badge={seoScore.score}
            className={cn("rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset", BADGE_COLOR[seoScore.level])}
          >
            SEO {seoScore.score}
          </button>
          <span className={cn("hidden rounded-full px-2.5 py-1 text-xs font-medium sm:inline", STATUS[status].className)}>
            {t.common.status[status]}
          </span>
          {isLiveOnSite && (
            <a
              href={viewUrl}
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
            onClick={() => setAiOpen(true)}
            disabled={saving || locked}
            title={t.editor.ai.buttonTitle}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 hover:border-brand-light hover:text-brand disabled:opacity-50"
          >
            <Sparkles className="size-4" />
            {t.editor.ai.button}
          </button>
          <button
            type="button"
            onClick={togglePanel}
            title={t.editor.header.settings}
            className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
          >
            {panelOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
          </button>
          {primaryIsSave ? (
            <button
              type="button"
              onClick={() => save()}
              disabled={saving || locked}
              title={isLive ? t.editor.publishing.updateTitle : t.editor.header.saveTitle}
              className={primaryButton}
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {isLive ? t.editor.publishing.update : t.common.save}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => save()}
                disabled={saving || locked}
                title={t.editor.header.saveTitle}
                className="rounded-lg border border-zinc-200 px-3.5 py-2 text-sm font-medium text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50"
              >
                {t.common.save}
              </button>
              {canPublish ? (
                <button
                  type="button"
                  onClick={() => setPublishOpen(true)}
                  disabled={saving || locked}
                  title={t.editor.publishing.publishTitle}
                  className={primaryButton}
                >
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  {t.editor.publishing.publish}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => save({ status: "in_review" })}
                  disabled={saving || locked}
                  title={t.editor.publishing.submitTitle}
                  className={primaryButton}
                >
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  {t.editor.publishing.submit}
                </button>
              )}
            </>
          )}
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
              <span suppressHydrationWarning>{formatDay(publishedAt ? new Date(publishedAt) : (translation?.publishedAt ?? new Date()), locale, timeZone)}</span>
              <span aria-hidden>•</span>
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="size-3.5" />
                {readingLabel(readingMinutes, locale)}
              </span>
            </div>
            <textarea
              id="field-title"
              data-undo-field
              value={title}
              onChange={(e) => edit(setTitle)(e.target.value.replace(/\n/g, ""))}
              // In the article's language, like the header preview above.
              placeholder={locale === "vi" ? "Tiêu đề bài viết" : "Article title"}
              rows={1}
              disabled={locked}
              className="mt-5 w-full resize-none overflow-hidden bg-transparent text-4xl font-extrabold leading-[1.16] tracking-[-0.035em] text-ink outline-none field-sizing-content placeholder:text-zinc-300 disabled:bg-transparent sm:text-[3.25rem]"
            />
            <textarea
              id="field-excerpt"
              data-undo-field
              value={excerpt}
              onChange={(e) => edit(setExcerpt)(e.target.value)}
              placeholder={t.editor.canvas.excerptPlaceholder}
              rows={1}
              disabled={locked}
              className="mt-5 w-full resize-none overflow-hidden bg-transparent text-lg leading-8 text-ink-soft outline-none field-sizing-content placeholder:text-zinc-300 disabled:bg-transparent sm:text-xl"
            />

            <div id="field-cover">
              <CoverImage
                url={coverImageUrl}
                siteId={site.id}
                disabled={locked}
                onChange={edit(setCoverImageUrl)}
                onError={setError}
              />
            </div>
            <hr className="my-8 border-line" />

            <div id="field-content">
              <RichTextEditor
                content={content.json}
                replacement={replacement}
                onChange={edit(setContent)}
                siteId={site.id}
                onError={setError}
                editable={!locked}
              />
            </div>
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
            <SeoScoreSection
              result={seoScore}
              otherLanguage={otherVersion ? t.common.locales[otherVersion.locale] : ""}
              onGo={goToCheck}
              versionHref={otherVersion ? `/admin/posts/${post.id}?locale=${otherVersion.locale}` : null}
              onLeave={confirmLeave}
            />
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
                  <strong className="font-semibold">{t.editor.blocks.h2.label}</strong>
                  {outlineEmptyAfter}
                </p>
              )}
            </Section>
            <Section id="planning" title={t.editor.panel.planning} hint={t.editor.panel.planningHint}>
              <PlanningFields
                postId={post.id}
                plannedFor={planning.plannedFor}
                assigneeId={planning.assigneeId}
                assignees={planning.assignees}
                canAssign={planning.canAssign}
              />
            </Section>
            <Section title={t.editor.panel.publish}>
              <Field label={t.editor.panel.status}>
                <select id="field-status" value={status} onChange={(e) => edit(setStatus)(e.target.value as PostStatus)} className={inputClass}>
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
              {canPublish && status !== "scheduled" && (
                <div className="flex flex-col gap-1.5">
                  {/* Field's hint slot is for short counters; this explanation is a sentence, so it goes below. */}
                  <Field label={t.editor.panel.publishedAt}>
                    <input
                      id="field-published-at"
                      type="datetime-local"
                      value={publishedAt}
                      onChange={(e) => edit(setPublishedAt)(e.target.value)}
                      className={inputClass}
                      suppressHydrationWarning
                    />
                  </Field>
                  <p className="text-xs leading-relaxed text-zinc-500">{t.editor.panel.publishedAtHint}</p>
                </div>
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
                  id="field-slug"
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
                <select id="field-category" value={categoryId} onChange={(e) => edit(setCategoryId)(e.target.value)} className={inputClass}>
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
              <ConfirmPopover
                message={t.editor.panel.confirmTrash}
                hint={t.editor.panel.confirmTrashHint}
                confirmLabel={t.editor.panel.trash}
                onConfirm={() => {
                  setDirty(false);
                  startDeleting(() => trashPostAndLeave(post.id));
                }}
              >
                {(open) => (
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={open}
                    className="inline-flex items-center gap-1.5 text-sm text-red-600 hover:text-red-800 disabled:opacity-60"
                  >
                    <Trash2 className="size-4" />
                    {t.editor.panel.trash}
                  </button>
                )}
              </ConfirmPopover>
            </div>
          )}
        </aside>
      </div>

      {aiOpen && (
        <AiDialog
          postId={post.id}
          locale={locale}
          site={site}
          categories={categories}
          source={otherVersion ? { locale: otherVersion.locale, exists: !!otherVersion.status } : null}
          enabled={aiEnabled}
          hasContent={!!title.trim() || countWords(content.html) > 0}
          dirty={dirty}
          initialKeyword={focusKeyword}
          initialMode={openAi}
          initialEngine={aiEngine}
          onTranslateOut={translateOut}
          onClose={() => setAiOpen(false)}
          onDone={(article, from) => {
            setAiOpen(false);
            setTitle(article.title);
            setExcerpt(article.excerpt);
            setMetaTitle(article.metaTitle);
            setMetaDescription(article.metaDescription);
            setFocusKeyword(article.focusKeyword);
            if (article.categoryId) setCategoryId(article.categoryId);
            // A slug not yet chosen follows the new title.
            if (!slugTouched || PLACEHOLDER_SLUG.test(slug)) setSlugTouched(false);
            setReplacement({ html: article.html, version: Date.now() });
            setTranslatedFrom(from);
            setDirty(true);
            setError(null);
            setNotice({ text: t.editor.ai.done });
          }}
        />
      )}

      {publishOpen && (
        <PublishDialog
          siteName={site.name}
          language={t.common.locales[locale]}
          url={publicUrl}
          seoScore={seoScore.score}
          otherUnpublished={otherUnpublished.map((tab) =>
            fmt(t.editor.publishing.otherUnpublished, {
              language: t.common.locales[tab.locale],
              current: t.common.locales[locale],
            }),
          )}
          initialWhen={scheduledAt}
          onCancel={() => setPublishOpen(false)}
          onConfirm={(when) => {
            setPublishOpen(false);
            save(when ? { status: "scheduled", scheduledAt: when } : { status: "published" });
          }}
        />
      )}

      {notice && !error && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 flex w-[min(92vw,32rem)] -translate-x-1/2 items-center gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-2xl"
        >
          <CircleCheck className="size-4 shrink-0 text-brand-bright" />
          <span className="flex-1">{notice.text}</span>
          {notice.href && (
            <a
              href={notice.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-brand-bright hover:underline"
            >
              {t.editor.publishing.view}
              <ExternalLink className="size-3.5" />
            </a>
          )}
          <button type="button" onClick={() => setNotice(null)} aria-label={t.common.close} className="text-zinc-400 hover:text-white">
            <X className="size-4" />
          </button>
        </div>
      )}

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

const primaryButton =
  "inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50";

/** An hour from now, on the hour, as a datetime-local value. */
function nextHour() {
  const date = new Date(Date.now() + 60 * 60_000);
  date.setMinutes(0, 0, 0);
  return toLocalInput(date);
}

/** Confirms where the article goes live, and whether now or at a set time. */
function PublishDialog({
  siteName,
  language,
  url,
  otherUnpublished,
  seoScore,
  initialWhen,
  onCancel,
  onConfirm,
}: {
  siteName: string;
  language: string;
  url: string;
  otherUnpublished: string[];
  seoScore: number;
  initialWhen: string;
  onCancel: () => void;
  /** `when` is a datetime-local value when scheduling, null to publish now. */
  onConfirm: (when: string | null) => void;
}) {
  const { t } = useI18n();
  const p = t.editor.publishing;
  const titleId = useId();
  const [later, setLater] = useState(false);
  const [when, setWhen] = useState(initialWhen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const options = [
    { later: false, icon: Send, label: p.now, hint: p.nowHint },
    { later: true, icon: CalendarClock, label: p.later, hint: p.laterHint },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 px-4 pt-[15vh]" onMouseDown={onCancel}>
      <form
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(later ? when : null);
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-ink">
              {fmt(p.dialogTitle, { site: siteName })}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">{fmt(p.dialogSubtitle, { language })}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t.common.close}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="size-4" />
          </button>
        </div>

        <fieldset className="mt-5 grid grid-cols-2 gap-2">
          {options.map((option) => (
            <label
              key={option.label}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-xl border p-3.5 transition",
                later === option.later ? "border-brand bg-brand-soft ring-2 ring-brand/15" : "border-zinc-200 hover:border-zinc-300",
              )}
            >
              <input
                type="radio"
                name="when"
                checked={later === option.later}
                onChange={() => {
                  setLater(option.later);
                  if (option.later && !when) setWhen(nextHour());
                }}
                className="sr-only"
              />
              <span className="flex items-center gap-2 font-semibold text-ink">
                <option.icon className={cn("size-4", later === option.later ? "text-brand" : "text-zinc-400")} />
                {option.label}
              </span>
              <span className="text-xs text-zinc-500">{option.hint}</span>
            </label>
          ))}
        </fieldset>

        {later && (
          <label className="mt-4 flex flex-col gap-1.5 text-sm font-medium text-zinc-700">
            {p.when}
            <input
              type="datetime-local"
              required
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className={inputClass}
              suppressHydrationWarning
            />
          </label>
        )}

        <div className="mt-4 rounded-lg bg-zinc-50 px-3 py-2.5 text-xs">
          <p className="font-medium text-zinc-500">{p.address}</p>
          <p className="mt-0.5 break-all text-zinc-800">{url}</p>
        </div>

        {seoScore < SCORE_THRESHOLDS.ok && (
          <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-amber-700">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {fmt(t.editor.score.publishWarning, { score: seoScore })}
          </p>
        )}

        {otherUnpublished.map((text) => (
          <p key={text} className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-amber-700">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {text}
          </p>
        ))}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100">
            {t.common.cancel}
          </button>
          <button type="submit" disabled={later && !when} className={primaryButton}>
            {later ? p.confirmLater : p.now}
          </button>
        </div>
      </form>
    </div>
  );
}

const DRAFT_LENGTHS: DraftLength[] = ["short", "medium", "long"];
const DRAFT_WORDS: Record<DraftLength, number> = { short: 600, medium: 1200, long: 2000 };

type AiArticle = ArticleFields & { categoryId: string | null };

/**
 * Drafts this version from a topic, or translates it from the other language, into the editor.
 * Two engines: the person's own Claude (copy a prompt, paste the answer back; no API key needed)
 * or the CMS's built-in AI (ANTHROPIC_API_KEY).
 */
function AiDialog({
  postId,
  locale,
  site,
  categories,
  source,
  enabled,
  hasContent,
  dirty,
  initialKeyword,
  initialMode,
  initialEngine,
  onTranslateOut,
  onClose,
  onDone,
}: {
  postId: string;
  locale: Locale;
  site: { id: string; name: string; baseUrl: string };
  categories: { id: string; name: string }[];
  /** The other language: where a translation comes from. */
  source: { locale: Locale; exists: boolean } | null;
  enabled: boolean;
  hasContent: boolean;
  /** This version has changes not saved yet (translating it out saves them first). */
  dirty: boolean;
  initialKeyword: string;
  initialMode: "translate" | null;
  initialEngine: "own" | "builtin" | null;
  /** Translate this version into `target`: done in that language's editor, which this opens. */
  onTranslateOut: (target: Locale, engine: "own" | "builtin") => void;
  onClose: () => void;
  /** `from` is set when the article was translated from that locale. */
  onDone: (article: AiArticle, from: Locale | null) => void;
}) {
  const { t } = useI18n();
  const a = t.editor.ai;
  const titleId = useId();
  // Into this version needs the other one saved; out of it needs something here to translate.
  const canTranslate = !!source?.exists;
  const canTranslateOut = !!source && hasContent;
  const [engine, setEngine] = useState<"own" | "builtin">(initialEngine ?? (enabled ? "builtin" : "own"));
  // An empty version with the other language written is most likely waiting to be translated.
  const [mode, setMode] = useState<"draft" | "translate">(initialMode ?? (canTranslate && !hasContent ? "translate" : "draft"));
  // A version with content is most likely the one to translate; an empty one waits for the other.
  const [direction, setDirection] = useState<"into" | "out">(!initialMode && canTranslateOut ? "out" : "into");
  const [topic, setTopic] = useState("");
  const [keyPoints, setKeyPoints] = useState("");
  const [keyword, setKeyword] = useState(initialKeyword);
  const [length, setLength] = useState<DraftLength>("medium");
  const [error, setError] = useState<string | null>(null);
  const [running, startRunning] = useTransition();
  const [seconds, setSeconds] = useState(0);
  // Own-Claude flow: the prompt that was copied, and the answer pasted back.
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState<"yes" | "manual" | null>(null);
  const [pasted, setPasted] = useState("");

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !running && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  const language = (l: Locale) => t.common.locales[l];
  const translatingOut = mode === "translate" && direction === "out" && !!source;
  const from = mode === "translate" && direction === "into" && source ? source.locale : null;
  const parsed = engine === "own" && pasted.trim() ? parsePastedArticle(pasted, categories) : null;
  const options = [
    { mode: "draft" as const, icon: PenLine, label: a.draft, hint: a.draftHint, disabled: false },
    {
      mode: "translate" as const,
      icon: Languages,
      label: a.translateCard,
      hint: canTranslate || canTranslateOut ? a.translateHint : source ? fmt(a.translateNothing, { language: language(source.locale) }) : "",
      disabled: !canTranslate && !canTranslateOut,
    },
  ];

  function runBuiltin() {
    setError(null);
    setSeconds(0);
    startRunning(async () => {
      const result = from
        ? await aiTranslate({ postId, from, to: locale })
        : await aiDraft({ postId, locale, topic, keyPoints, focusKeyword: keyword, length });
      if (!result.ok) setError(result.error);
      else onDone(result.article, from);
    });
  }

  /** Builds the prompt for the person's own Claude and puts it on the clipboard. */
  function copyPrompt() {
    setError(null);
    if (!from && topic.trim().length < 3) {
      setError(a.errors.topic);
      return;
    }
    startRunning(async () => {
      let text: string;
      if (from) {
        const result = await aiSourceArticle({ postId, from });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        text = translatePrompt({ site, from, to: locale, source: result.source });
      } else {
        text = draftPrompt({ site, locale, topic, keyPoints, focusKeyword: keyword, words: DRAFT_WORDS[length], categories });
      }
      setPrompt(text);
      try {
        await navigator.clipboard.writeText(text);
        setCopied("yes");
      } catch {
        // No clipboard access (e.g. a plain-http address): the prompt is shown below to copy by hand.
        setCopied("manual");
      }
    });
  }

  function fillFromPaste() {
    if (!parsed?.ok) return;
    const p = parsed.article;
    onDone(
      {
        title: p.title,
        excerpt: p.excerpt,
        metaTitle: p.metaTitle,
        metaDescription: p.metaDescription,
        focusKeyword: p.focusKeyword,
        html: p.html,
        // Articles share one category across languages, so a translation leaves it alone.
        categoryId: from ? null : p.categoryId,
      },
      from,
    );
  }

  const stepClass = "flex items-center gap-2 text-sm font-semibold text-ink";
  const stepNumber = "flex size-5 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 px-4 py-[8vh]" onMouseDown={() => !running && onClose()}>
      <form
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (translatingOut && source) onTranslateOut(source.locale, engine);
          else if (engine === "own") fillFromPaste();
          else runBuiltin();
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold text-ink">
              <Sparkles className="size-4 text-brand" />
              {a.title}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">{a.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            aria-label={t.common.close}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Which AI writes */}
        <div className="mt-5 flex rounded-lg bg-zinc-100 p-1" role="radiogroup" aria-label={a.engine}>
          {(["own", "builtin"] as const).map((e) => (
            <button
              key={e}
              type="button"
              role="radio"
              aria-checked={engine === e}
              disabled={running}
              onClick={() => {
                setEngine(e);
                setError(null);
              }}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition",
                engine === e ? "bg-white text-ink shadow-sm" : "text-zinc-500 hover:text-zinc-800",
              )}
            >
              {e === "own" ? a.engineOwn : a.engineBuiltin}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-500">{engine === "own" ? a.engineOwnHint : enabled ? a.engineBuiltinHint : a.errors.not_configured}</p>

        <fieldset disabled={running} className="mt-4 grid grid-cols-2 gap-2">
          {options.map((option) => (
            <label
              key={option.mode}
              className={cn(
                "flex flex-col gap-1 rounded-xl border p-3.5 transition",
                option.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                mode === option.mode ? "border-brand bg-brand-soft ring-2 ring-brand/15" : "border-zinc-200 hover:border-zinc-300",
              )}
            >
              <input
                type="radio"
                name="aiMode"
                checked={mode === option.mode}
                disabled={option.disabled}
                onChange={() => {
                  setMode(option.mode);
                  setPrompt("");
                  setCopied(null);
                }}
                className="sr-only"
              />
              <span className="flex items-center gap-2 font-semibold text-ink">
                <option.icon className={cn("size-4", mode === option.mode ? "text-brand" : "text-zinc-400")} />
                {option.label}
              </span>
              <span className="text-xs text-zinc-500">{option.hint}</span>
            </label>
          ))}
        </fieldset>

        <fieldset disabled={running} className="mt-4 flex flex-col gap-3">
          {mode === "translate" && source && (
            <div role="radiogroup" aria-label={a.direction} className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: "out", from: locale, to: source.locale, possible: canTranslateOut },
                  { id: "into", from: source.locale, to: locale, possible: canTranslate },
                ] as const
              ).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={direction === d.id}
                  disabled={!d.possible}
                  data-direction={d.id}
                  onClick={() => {
                    setDirection(d.id);
                    setPrompt("");
                    setCopied(null);
                  }}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
                    direction === d.id ? "border-brand bg-brand-soft text-brand" : "border-zinc-200 text-zinc-600 hover:border-zinc-300",
                  )}
                >
                  {language(d.from)}
                  <ArrowRight className="size-3.5" />
                  {language(d.to)}
                </button>
              ))}
            </div>
          )}
          {translatingOut && source ? (
            <p className="rounded-lg bg-zinc-50 px-3 py-2.5 text-sm leading-relaxed text-zinc-600">
              {fmt(a.translateOutHint, { from: language(locale), to: language(source.locale) })}
            </p>
          ) : (
          <>
          {engine === "own" && <p className={stepClass}><span className={stepNumber}>1</span>{a.step1}</p>}
          {mode === "draft" ? (
            <>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-700">
                {a.topic}
                <textarea
                  required={engine === "builtin"}
                  minLength={3}
                  rows={2}
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder={a.topicPlaceholder}
                  className={cn(inputClass, "resize-none")}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-700">
                {a.keyPoints}
                <textarea
                  rows={3}
                  value={keyPoints}
                  onChange={(e) => setKeyPoints(e.target.value)}
                  placeholder={a.keyPointsPlaceholder}
                  className={cn(inputClass, "resize-y")}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-700">
                  {a.focusKeyword}
                  <input value={keyword} onChange={(e) => setKeyword(e.target.value)} className={inputClass} />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-700">
                  {a.length}
                  <select value={length} onChange={(e) => setLength(e.target.value as DraftLength)} className={inputClass}>
                    {DRAFT_LENGTHS.map((l) => (
                      <option key={l} value={l}>
                        {a.lengths[l]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          ) : (
            source && (
              <p className="rounded-lg bg-zinc-50 px-3 py-2.5 text-sm text-zinc-600">
                {fmt(engine === "own" ? a.translateNoteOwn : a.translateNote, { from: language(source.locale), to: language(locale) })}
              </p>
            )
          )}

          {engine === "own" && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={copyPrompt}
                  className="inline-flex items-center gap-2 rounded-lg border border-brand px-3.5 py-2 text-sm font-semibold text-brand hover:bg-brand-soft"
                >
                  {running ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
                  {a.copyPrompt}
                </button>
                <a
                  href="https://claude.ai/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:text-brand-hover"
                >
                  {a.openClaude}
                  <ExternalLink className="size-3.5" />
                </a>
                {copied === "yes" && (
                  <span role="status" className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                    <Check className="size-3.5" />
                    {a.copied}
                  </span>
                )}
              </div>
              {prompt && (
                <details open={copied === "manual"} className="rounded-lg border border-zinc-200 bg-zinc-50 text-xs">
                  <summary className="cursor-pointer px-3 py-2 font-medium text-zinc-600">
                    {copied === "manual" ? a.copyFailed : a.showPrompt}
                  </summary>
                  <textarea
                    readOnly
                    value={prompt}
                    rows={6}
                    onFocus={(e) => e.currentTarget.select()}
                    aria-label={a.showPrompt}
                    className="block w-full resize-y border-t border-zinc-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-zinc-700 outline-none"
                  />
                </details>
              )}

              <p className={cn(stepClass, "mt-2")}><span className={stepNumber}>2</span>{a.step2}</p>
              <textarea
                rows={5}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={a.pastePlaceholder}
                aria-label={a.step2}
                className={cn(inputClass, "resize-y font-mono text-xs")}
              />
              <p className="-mt-1 text-xs text-zinc-500">{a.step2Hint}</p>
              {parsed &&
                (parsed.ok ? (
                  <p role="status" className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    <CircleCheck className="mt-0.5 size-4 shrink-0" />
                    <span>
                      {fmt(a.detected, { title: parsed.article.title, n: parsed.article.sections })}
                      {!from &&
                        parsed.article.categoryName &&
                        (parsed.article.categoryId
                          ? fmt(a.detectedCategory, { name: parsed.article.categoryName })
                          : fmt(a.categoryUnknown, { name: parsed.article.categoryName }))}
                    </span>
                  </p>
                ) : (
                  <p role="alert" className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    {a.pasteErrors[parsed.error]}
                  </p>
                ))}
            </>
          )}
          </>
          )}
        </fieldset>

        {hasContent && !translatingOut && (
          <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-amber-700">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {a.replaceWarning}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}
        {running && engine === "builtin" && (
          <p role="status" className="mt-3 flex items-center gap-2 text-sm text-zinc-600">
            <Loader2 className="size-4 animate-spin text-brand" />
            {fmt(a.working, { seconds })}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
          >
            {t.common.cancel}
          </button>
          {translatingOut && source ? (
            <button type="submit" className={primaryButton}>
              <Languages className="size-4" />
              {fmt(dirty ? a.translateOutSave : a.translateOut, { language: language(source.locale) })}
            </button>
          ) : engine === "own" ? (
            <button type="submit" disabled={running || !parsed?.ok} className={primaryButton}>
              <Check className="size-4" />
              {a.fill}
            </button>
          ) : (
            <button type="submit" disabled={running || !enabled || (mode === "translate" && !canTranslate)} className={primaryButton}>
              {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {mode === "translate" && source ? fmt(a.translate, { language: language(source.locale) }) : a.draft}
            </button>
          )}
        </div>
      </form>
    </div>
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

const LEVEL_COLOR = { good: "text-emerald-600", ok: "text-amber-500", weak: "text-red-500" } as const;
const BADGE_COLOR = {
  good: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  ok: "bg-amber-50 text-amber-700 ring-amber-200",
  weak: "bg-red-50 text-red-600 ring-red-200",
} as const;

/** Where each check is fixed; content checks go to the article body. */
const CHECK_TARGET: Partial<Record<CheckId, string>> = {
  seoTitleLength: "field-meta-title",
  keywordInTitle: "field-meta-title",
  metaDescriptionLength: "field-meta-description",
  keywordInDescription: "field-meta-description",
  keywordSet: "field-keyword",
  keywordInSlug: "field-slug",
  slugLength: "field-slug",
  excerpt: "field-excerpt",
  category: "field-category",
  cover: "field-cover",
  keywordInIntro: "field-content",
  keywordInHeading: "field-content",
  wordCount: "field-content",
  sections: "field-content",
  shortParagraphs: "field-content",
  internalLinks: "field-content",
  imagesAlt: "field-content",
};

/** Circular gauge of the SEO score. */
function ScoreRing({ score, level }: { score: number; level: ScoreResult["level"] }) {
  const r = 24;
  const length = 2 * Math.PI * r;
  return (
    <div className={cn("relative size-16 shrink-0", LEVEL_COLOR[level])}>
      <svg viewBox="0 0 56 56" className="size-16 -rotate-90" aria-hidden="true">
        <circle cx="28" cy="28" r={r} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth="6" />
        <circle cx="28" cy="28" r={r} fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(score / 100) * length} ${length}`} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-ink">{score}</span>
    </div>
  );
}

/** The SEO score with what to fix first (the checks worth the most points lead). */
function SeoScoreSection({
  result,
  otherLanguage,
  onGo,
  versionHref,
  onLeave,
}: {
  result: ScoreResult;
  otherLanguage: string;
  onGo: (id: CheckId) => void;
  /** The other language's editor, for the translation check. */
  versionHref: string | null;
  onLeave: (event: React.MouseEvent) => void;
}) {
  const { t } = useI18n();
  const s = t.editor.score;
  const [showAll, setShowAll] = useState(false);
  const vars = (c: ScoreCheck) => ({ ...c.vars, language: otherLanguage });
  const missing = (c: ScoreCheck) => c.weight * (1 - c.earned);
  const todo = result.checks.filter((c) => c.earned < 1).sort((a, b) => missing(b) - missing(a));
  const done = result.checks.filter((c) => c.earned === 1);
  const shown = showAll ? todo : todo.slice(0, 3);
  const action = "mt-1 inline-flex items-center gap-1 font-semibold text-brand hover:underline";
  const groups = (["seo", "content", "trust"] as const).map((g) => {
    const list = result.checks.filter((c) => c.group === g);
    return { g, earned: Math.round(list.reduce((n, c) => n + c.weight * c.earned, 0)), total: list.reduce((n, c) => n + c.weight, 0) };
  });

  return (
    <Section id="seo-score" title={s.title} hint={s.hint}>
      <div className="flex items-center gap-4" data-seo-score={result.score}>
        <ScoreRing score={result.score} level={result.level} />
        <div className="min-w-0">
          <p className={cn("text-sm font-semibold", LEVEL_COLOR[result.level])}>{s.levels[result.level]}</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs text-zinc-500">
            {groups.map(({ g, earned, total }) => (
              <li key={g}>
                {s.groups[g]}: <span className="font-medium text-zinc-700">{earned}</span>/{total}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {todo.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-zinc-600">{fmt(s.toFix, { n: todo.length })}</p>
          <ul className="mt-2 flex flex-col gap-3">
            {shown.map((c) => (
              <li key={c.id} className="flex gap-2 text-xs" data-check={c.id}>
                {c.earned > 0 ? (
                  <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                ) : (
                  <CircleX className="mt-0.5 size-3.5 shrink-0 text-red-400" />
                )}
                <div className="min-w-0">
                  <p className="font-medium text-zinc-800">
                    {fmt(s.checks[c.id].label, vars(c))} <span className="font-normal text-zinc-400">+{Math.round(missing(c))}</span>
                  </p>
                  <p className="mt-0.5 leading-relaxed text-zinc-500">{fmt(s.checks[c.id].fix, vars(c))}</p>
                  {c.id === "author" ? (
                    <a href="/admin/account" target="_blank" rel="noopener" className={action}>
                      {s.openAccount} <ExternalLink className="size-3" />
                    </a>
                  ) : c.id === "translation" ? (
                    versionHref && (
                      <Link href={versionHref} onClick={onLeave} className={action}>
                        {fmt(s.openVersion, { language: otherLanguage })} <ArrowRight className="size-3" />
                      </Link>
                    )
                  ) : (
                    <button type="button" onClick={() => onGo(c.id)} className={action}>
                      {s.fixIt} <ArrowRight className="size-3" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {todo.length > 3 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-3 text-xs font-semibold text-zinc-600 hover:text-zinc-900">
              {showAll ? s.showLess : fmt(s.showAll, { n: todo.length })}
            </button>
          )}
        </div>
      )}
      {done.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-semibold text-zinc-600">{fmt(s.done, { n: done.length })}</summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {done.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-zinc-600">
                <CircleCheck className="size-3.5 shrink-0 text-emerald-600" />
                {fmt(s.checks[c.id].label, vars(c))}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}

function SeoSection(props: {
  title: string;
  excerpt: string;
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
          id="field-meta-title"
          value={props.metaTitle}
          onChange={(e) => props.onMetaTitle(e.target.value)}
          placeholder={props.title || seo.metaTitlePlaceholder}
          className={inputClass}
        />
      </Field>
      <Field label={seo.metaDescription} hint={<Counter value={seoDescription} max={160} />}>
        <textarea
          id="field-meta-description"
          value={props.metaDescription}
          onChange={(e) => props.onMetaDescription(e.target.value)}
          placeholder={props.excerpt || seo.metaDescriptionPlaceholder}
          rows={3}
          className={cn(inputClass, "resize-none")}
        />
      </Field>
      <Field label={seo.focusKeyword}>
        <input
          id="field-keyword"
          value={props.focusKeyword}
          onChange={(e) => props.onFocusKeyword(e.target.value)}
          placeholder={seo.focusKeywordPlaceholder}
          className={inputClass}
        />
      </Field>
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
