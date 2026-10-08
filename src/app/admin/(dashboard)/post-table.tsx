"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ExternalLink,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { ConfirmPopover } from "@/components/confirm-popover";
import type { Locale, PostStatus } from "@/db/schema";
import { plural, fmt } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { STATUS } from "@/lib/posts";
import { scoreLevel } from "@/lib/seo-score";
import { cn } from "@/lib/utils";
import { deletePostsForever, restorePosts, trashPosts, type BulkResult } from "../posts/actions";
import type { SortDir, SortKey } from "./post-list";

export type PostRow = {
  id: string;
  title: string;
  href: string;
  siteName: string;
  category: string | null;
  featured: boolean;
  coverImageUrl: string | null;
  author: string | null;
  /** `score`: the version's SEO score (0–100), null when it is not written yet. */
  locales: { locale: Locale; href: string; status: PostStatus | null; stale: boolean; score: number | null }[];
  publicUrl: string | null;
  updatedLabel: string;
  trashedLabel: string | null;
  canDelete: boolean;
};

const SCORE_COLOR = { good: "text-emerald-600", ok: "text-amber-600", weak: "text-red-500" } as const;

/** For each sortable column: where clicking it leads, and its direction when it is the current sort. */
export type SortLinks = Record<SortKey, { href: string; dir: SortDir | null }>;

type Props = { rows: PostRow[]; sortLinks: SortLinks; trash: boolean; canPurge: boolean; emptyTitle: string; emptyHint: string };

/** A column header that sorts the list by that column (again: the other way round). */
function SortHeader({ link, label, hint, right }: { link: SortLinks[SortKey]; label: string; hint: string; right?: boolean }) {
  const Icon = link.dir === "asc" ? ArrowUp : link.dir === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <th
      className={cn("px-3 py-3 font-medium", right && "text-right")}
      aria-sort={link.dir === "asc" ? "ascending" : link.dir === "desc" ? "descending" : undefined}
    >
      <Link
        href={link.href}
        title={hint}
        data-sort-link
        className={cn("inline-flex items-center gap-1 hover:text-zinc-800", link.dir && "font-semibold text-zinc-800")}
      >
        {label}
        <Icon className={cn("size-3.5", !link.dir && "text-zinc-300")} aria-hidden />
      </Link>
    </th>
  );
}
type Toast = { text: string; undo?: string[] };

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function PostTable({ rows, sortLinks, trash, canPurge, emptyTitle, emptyHint }: Props) {
  const { t: dict } = useI18n();
  const t = dict.posts.table;
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, startBusy] = useTransition();

  const selectable = rows.filter((r) => r.canDelete);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function run(action: (ids: string[]) => Promise<BulkResult>, ids: string[], describe: (n: number) => string, undo = false) {
    startBusy(async () => {
      const result = await action(ids);
      setSelected(new Set());
      const skipped = result.skipped ? fmt(t.skipped, { n: result.skipped }) : "";
      setToast({ text: `${describe(result.done)}${skipped}`, undo: undo && result.done ? ids : undefined });
      router.refresh();
    });
  }

  const moveToTrash = (ids: string[]) => run(trashPosts, ids, (n) => plural(n, t.trashedOne, t.trashedOther), true);
  const restore = (ids: string[]) => run(restorePosts, ids, (n) => plural(n, t.restoredOne, t.restoredOther));
  const purge = (ids: string[]) => run(deletePostsForever, ids, (n) => plural(n, t.deletedOne, t.deletedOther));

  if (rows.length === 0) {
    return (
      <>
        <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-400">
            {trash ? <Trash2 className="size-5" /> : <FileText className="size-5" />}
          </span>
          <p className="font-medium">{emptyTitle}</p>
          <p className="text-sm text-zinc-500">{emptyHint}</p>
        </div>
        <ToastBar toast={toast} busy={busy} onUndo={(ids) => restore(ids)} onClose={() => setToast(null)} undoLabel={t.undo} closeLabel={dict.common.close} />
      </>
    );
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-brand-tint bg-brand-soft px-4 py-2 text-sm">
          <span className="font-semibold text-brand">{fmt(t.selected, { n: selected.size })}</span>
          {trash ? (
            <>
              <BarButton icon={RotateCcw} onClick={() => restore([...selected])} disabled={busy}>
                {t.restore}
              </BarButton>
              {canPurge && (
                <ConfirmPopover
                  message={fmt(t.confirmDeleteForever, { n: selected.size })}
                  hint={t.confirmDeleteForeverHint}
                  confirmLabel={t.deleteForever}
                  onConfirm={() => purge([...selected])}
                >
                  {(open) => (
                    <BarButton icon={Trash2} danger onClick={open} disabled={busy}>
                      {t.deleteForever}
                    </BarButton>
                  )}
                </ConfirmPopover>
              )}
            </>
          ) : (
            <ConfirmPopover
              message={selected.size === 1 ? t.confirmTrashOne : fmt(t.confirmTrashMany, { n: selected.size })}
              hint={t.confirmTrashHint}
              confirmLabel={t.trash}
              onConfirm={() => moveToTrash([...selected])}
            >
              {(open) => (
                <BarButton icon={Trash2} danger onClick={open} disabled={busy}>
                  {t.trash}
                </BarButton>
              )}
            </ConfirmPopover>
          )}
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-xs font-medium text-zinc-500 hover:text-zinc-800">
            {t.clearSelection}
          </button>
          {busy && <Loader2 className="size-4 animate-spin text-brand" />}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="text-xs text-zinc-500">
            <tr className="border-b border-zinc-100">
              <th className="w-10 py-3 pl-4">
                <input
                  type="checkbox"
                  aria-label={t.selectAll}
                  checked={allSelected}
                  disabled={selectable.length === 0}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.id)))}
                  className="size-4 accent-brand"
                />
              </th>
              <SortHeader link={sortLinks.title} label={t.article} hint={t.sortTitle} />
              <th className="px-3 py-3 font-medium">{t.author}</th>
              <SortHeader link={sortLinks.vi} label={dict.common.locales.vi} hint={fmt(t.sortStatus, { locale: "VI" })} />
              <SortHeader link={sortLinks.en} label={dict.common.locales.en} hint={fmt(t.sortStatus, { locale: "EN" })} />
              <SortHeader link={sortLinks.updated} label={trash ? t.deleted : t.updated} hint={t.sortDate} right />
              <th className="w-28 px-3 py-3" aria-label={t.actions} />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((row) => (
              <tr key={row.id} className={cn("group", selected.has(row.id) ? "bg-brand-soft/60" : "hover:bg-zinc-50/80")}>
                <td className="py-3 pl-4">
                  <input
                    type="checkbox"
                    aria-label={fmt(t.select, { title: row.title || dict.common.untitled })}
                    checked={selected.has(row.id)}
                    disabled={!row.canDelete}
                    onChange={() => toggle(row.id)}
                    className="size-4 accent-brand disabled:opacity-30"
                  />
                </td>
                <td className="px-3 py-3">
                  <Link href={row.href} className="flex items-center gap-3">
                    {row.coverImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- uploaded or external URL
                      <img src={row.coverImageUrl} alt="" className="h-11 w-16 shrink-0 rounded-md border border-zinc-200 object-cover" />
                    ) : (
                      <span className="flex h-11 w-16 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-300">
                        <FileText className="size-4" />
                      </span>
                    )}
                    <span className="min-w-0">
                      <span
                        className={cn(
                          "flex items-center gap-1.5 font-medium group-hover:text-brand",
                          row.title ? "text-zinc-900" : "italic text-zinc-400",
                        )}
                      >
                        {row.featured && <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />}
                        <span className="line-clamp-1">{row.title || dict.common.untitled}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
                        <span className="rounded bg-zinc-100 px-1.5 py-px font-medium text-zinc-600">{row.siteName}</span>
                        {row.category ?? t.uncategorized}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-3">
                  {row.author ? (
                    <span className="flex items-center gap-2 text-zinc-600">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-semibold text-zinc-600">
                        {initials(row.author)}
                      </span>
                      <span className="truncate">{row.author}</span>
                    </span>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </td>
                {row.locales.map((l) => (
                  <td key={l.locale} className="px-3 py-3" data-locale={l.locale} data-status={l.status ?? "none"}>
                    {l.status ? (
                      <Link href={l.href} className="inline-flex flex-col items-start gap-1">
                        <span className="flex items-center gap-2">
                          <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", STATUS[l.status].className)}>
                            {dict.common.status[l.status]}
                          </span>
                          {l.score !== null && (
                            <span
                              title={t.seoScore}
                              className={cn("whitespace-nowrap text-[11px] font-semibold", SCORE_COLOR[scoreLevel(l.score)])}
                            >
                              SEO {l.score}
                            </span>
                          )}
                        </span>
                        {l.stale && (
                          <span className="flex items-center gap-1 text-[11px] font-medium text-orange-600">
                            <AlertTriangle className="size-3" />
                            {t.needsRetranslation}
                          </span>
                        )}
                      </Link>
                    ) : trash ? (
                      <span className="text-xs text-zinc-300">—</span>
                    ) : (
                      <Link
                        href={l.href}
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-xs text-zinc-400 hover:border-brand-light hover:text-brand"
                      >
                        <Plus className="size-3" />
                        {t.writeTranslation}
                      </Link>
                    )}
                  </td>
                ))}
                <td className="whitespace-nowrap px-3 py-3 text-right text-xs text-zinc-500">
                  {trash ? row.trashedLabel : row.updatedLabel}
                </td>
                <td className="px-3 py-3">
                  <div className="flex justify-end gap-0.5 opacity-60 transition group-hover:opacity-100 group-focus-within:opacity-100">
                    {trash ? (
                      <>
                        {row.canDelete && (
                          <RowButton icon={RotateCcw} label={t.restore} onClick={() => restore([row.id])} disabled={busy} />
                        )}
                        {canPurge && (
                          <ConfirmPopover
                            message={fmt(t.confirmDeleteForever, { n: 1 })}
                            hint={t.confirmDeleteForeverHint}
                            confirmLabel={t.deleteForever}
                            onConfirm={() => purge([row.id])}
                          >
                            {(open) => <RowButton icon={Trash2} label={t.deleteForever} danger onClick={open} disabled={busy} />}
                          </ConfirmPopover>
                        )}
                      </>
                    ) : (
                      <>
                        <Link
                          href={row.href}
                          title={t.edit}
                          aria-label={t.edit}
                          className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                        >
                          <Pencil className="size-4" />
                        </Link>
                        {row.publicUrl && (
                          <a
                            href={row.publicUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={t.view}
                            aria-label={t.view}
                            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                          >
                            <ExternalLink className="size-4" />
                          </a>
                        )}
                        {row.canDelete && (
                          <ConfirmPopover
                            message={t.confirmTrashOne}
                            hint={t.confirmTrashHint}
                            confirmLabel={t.trash}
                            onConfirm={() => moveToTrash([row.id])}
                          >
                            {(open) => <RowButton icon={Trash2} label={t.trash} danger onClick={open} disabled={busy} />}
                          </ConfirmPopover>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ToastBar
        toast={toast}
        busy={busy}
        onUndo={(ids) => restore(ids)}
        onClose={() => setToast(null)}
        undoLabel={t.undo}
        closeLabel={dict.common.close}
      />
    </>
  );
}

function RowButton({
  icon: Icon,
  label,
  danger,
  disabled,
  onClick,
}: {
  icon: typeof Trash2;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-md p-1.5 disabled:opacity-40",
        danger ? "text-zinc-500 hover:bg-red-50 hover:text-red-600" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

function BarButton({
  icon: Icon,
  danger,
  disabled,
  onClick,
  children,
}: {
  icon: typeof Trash2;
  danger?: boolean;
  disabled?: boolean;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-50",
        danger ? "border-red-200 text-red-600 hover:bg-red-50" : "border-zinc-200 text-zinc-700 hover:bg-zinc-50",
      )}
    >
      <Icon className="size-3.5" />
      {children}
    </button>
  );
}

function ToastBar({
  toast,
  busy,
  onUndo,
  onClose,
  undoLabel,
  closeLabel,
}: {
  toast: Toast | null;
  busy: boolean;
  onUndo: (ids: string[]) => void;
  onClose: () => void;
  undoLabel: string;
  closeLabel: string;
}) {
  if (!toast) return null;
  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-50 flex w-[min(92vw,30rem)] -translate-x-1/2 items-center gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-2xl"
    >
      <span className="flex-1">{toast.text}</span>
      {toast.undo && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onUndo(toast.undo!)}
          className="font-semibold text-brand-light hover:text-white disabled:opacity-50"
        >
          {undoLabel}
        </button>
      )}
      <button type="button" onClick={onClose} aria-label={closeLabel} className="text-white/50 hover:text-white">
        <X className="size-4" />
      </button>
    </div>
  );
}
