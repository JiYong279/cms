"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/i18n/client";

type Anchor = { top?: number; bottom?: number; right: number };

/**
 * Asks "are you sure?" in a small box next to the button that was clicked, instead of acting
 * straight away. `children` renders that button and calls `open` from its click handler.
 */
export function ConfirmPopover({
  message,
  hint,
  confirmLabel,
  onConfirm,
  children,
}: {
  message: string;
  hint?: string;
  confirmLabel: string;
  onConfirm: () => void;
  /** `open` takes the event of the control it should sit next to: a button's click, a select's change. */
  children: (open: (event: { currentTarget: Element }) => void) => React.ReactNode;
}) {
  const { t } = useI18n();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  function open(event: { currentTarget: Element }) {
    const rect = event.currentTarget.getBoundingClientRect();
    // Right-aligned with the button, kept inside the window (the box is w-72 = 288px wide).
    const right = Math.min(Math.max(8, window.innerWidth - rect.right), Math.max(8, window.innerWidth - 288 - 8));
    // Below the button, or above it when it sits near the bottom of the window.
    setAnchor(
      rect.bottom + 170 > window.innerHeight
        ? { bottom: window.innerHeight - rect.top + 6, right }
        : { top: rect.bottom + 6, right },
    );
  }

  useEffect(() => {
    if (!anchor) return;
    const close = () => setAnchor(null);
    const onPointer = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [anchor]);

  return (
    <>
      {children(open)}
      {anchor && (
        <div
          ref={boxRef}
          role="alertdialog"
          aria-labelledby={titleId}
          style={{ top: anchor.top, bottom: anchor.bottom, right: anchor.right }}
          className="fixed z-50 w-72 rounded-xl border border-zinc-200 bg-white p-3.5 text-left shadow-xl"
        >
          <p id={titleId} className="flex items-start gap-2 text-sm font-semibold text-ink">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" />
            {message}
          </p>
          {hint && <p className="mt-1 pl-6 text-xs leading-relaxed text-zinc-500">{hint}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              autoFocus
              onClick={() => setAnchor(null)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100"
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              onClick={() => {
                setAnchor(null);
                onConfirm();
              }}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
