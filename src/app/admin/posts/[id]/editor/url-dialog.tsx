"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/i18n/client";

export type UrlDialogConfig = {
  title: string;
  description: string;
  placeholder: string;
  /** Adds a second field for the image description (alt). */
  withAlt?: boolean;
  validate: (url: string) => string | null;
  onSubmit: (url: string, alt: string) => void;
};

/** Small modal asking for a link, used to insert an image by URL or a YouTube video. */
export function UrlDialog({ config, onClose }: { config: UrlDialogConfig; onClose: () => void }) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 px-4 pt-[18vh]" onMouseDown={onClose}>
      <form
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          const problem = config.validate(url.trim());
          if (problem) return setError(problem);
          config.onSubmit(url.trim(), alt.trim());
          onClose();
        }}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-ink">{config.title}</h2>
            <p className="mt-1 text-sm text-zinc-500">{config.description}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t.common.close} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100">
            <X className="size-4" />
          </button>
        </div>
        <input
          autoFocus
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          placeholder={config.placeholder}
          className="mt-4 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
        />
        {config.withAlt && (
          <input
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            placeholder={t.editor.urlDialog.altPlaceholder}
            className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100">
            {t.common.cancel}
          </button>
          <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover">
            {t.editor.urlDialog.insert}
          </button>
        </div>
      </form>
    </div>
  );
}
