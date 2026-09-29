"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { ExternalLink, ImageIcon, Loader2, Search, X } from "lucide-react";
import { fmt } from "@/i18n";
import { useI18n } from "@/i18n/client";
import type { StockPhoto } from "@/lib/stock-images";
import { cn } from "@/lib/utils";
import { importStock, searchStock, type StockImportResult } from "../../stock-actions";

type Props = {
  siteId: string;
  locale: "vi" | "en";
  /** What to search for first (an image suggestion's description). */
  initialQuery: string;
  onPick: (image: Extract<StockImportResult, { ok: true }>) => void;
  onClose: () => void;
};

/** Search free stock photos (Pexels) and copy the chosen one into our own image storage. */
export function StockDialog({ siteId, locale, initialQuery, onPick, onClose }: Props) {
  const { t } = useI18n();
  const s = t.editor.stock;
  const titleId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [photos, setPhotos] = useState<StockPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<number | null>(null);
  const [searching, startSearch] = useTransition();
  const [importing, startImport] = useTransition();

  async function load(q: string) {
    const result = await searchStock({ query: q, locale });
    if (result.ok) setPhotos(result.photos);
    else setError(result.error);
  }

  function search(q: string) {
    setError(null);
    startSearch(() => load(q));
  }

  // Search right away when opened from a suggestion that says what to show.
  useEffect(() => {
    if (initialQuery.trim().length >= 2) startSearch(() => load(initialQuery));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on opening; later searches come from the form
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !importing && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, importing]);

  function pick(photo: StockPhoto) {
    setError(null);
    setPicking(photo.id);
    startImport(async () => {
      const result = await importStock({ photoId: photo.id, siteId });
      setPicking(null);
      if (result.ok) onPick(result);
      else setError(result.error);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 px-4 py-[6vh]" onMouseDown={() => !importing && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-stock-dialog
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-3xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold text-ink">
              <ImageIcon className="size-4 text-brand" />
              {s.title}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">{s.subtitle}</p>
          </div>
          <button type="button" onClick={onClose} disabled={importing} aria-label={t.common.close} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <X className="size-4" />
          </button>
        </div>

        <form
          className="relative mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            search(query);
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={s.placeholder}
            aria-label={s.placeholder}
            className="w-full rounded-lg border border-zinc-300 py-2.5 pl-9 pr-24 text-sm outline-none focus:border-brand-bright focus:ring-2 focus:ring-brand-bright/20"
          />
          <button type="submit" disabled={searching || query.trim().length < 2} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            {s.search}
          </button>
        </form>

        {error && <p role="alert" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</p>}
        {searching && (
          <p role="status" className="mt-4 flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="size-4 animate-spin" />
            {s.searching}
          </p>
        )}
        {photos && !searching && (
          photos.length === 0 ? (
            <p className="mt-6 text-center text-sm text-zinc-500">{s.none}</p>
          ) : (
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3" data-stock-results>
              {photos.map((photo) => (
                <li key={photo.id}>
                  <button
                    type="button"
                    onClick={() => pick(photo)}
                    disabled={importing}
                    data-stock-photo={photo.id}
                    className={cn("group relative block w-full overflow-hidden rounded-xl border border-zinc-200 text-left transition hover:border-brand", picking === photo.id && "ring-2 ring-brand")}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- previews come straight from Pexels */}
                    <img src={photo.thumb} alt={photo.alt} className="aspect-[3/2] w-full object-cover" />
                    <span className="block truncate px-2 py-1.5 text-[11px] text-zinc-500">{fmt(s.by, { name: photo.photographer })}</span>
                    {picking === photo.id && (
                      <span className="absolute inset-0 flex items-center justify-center bg-white/70">
                        <Loader2 className="size-5 animate-spin text-brand" />
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
        <p className="mt-4 flex items-center gap-1 text-xs text-zinc-400">
          {s.licence}
          <a href="https://www.pexels.com/license/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-medium text-zinc-500 hover:text-zinc-700">
            Pexels <ExternalLink className="size-3" />
          </a>
        </p>
      </div>
    </div>
  );
}
