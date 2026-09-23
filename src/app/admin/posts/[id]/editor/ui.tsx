"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Text colours offered in the editor: Qub-X brand tones only, so articles stay on-brand. Names: `editor.colors[id]`. */
export const TEXT_COLORS = [
  { id: "default", value: null },
  { id: "brand", value: "#0a6b45" },
  { id: "green", value: "#16a260" },
  { id: "ink", value: "#222f30" },
  { id: "gray", value: "#66777b" },
  { id: "red", value: "#dc2626" },
  { id: "orange", value: "#d97706" },
] as const;

/** Background highlights. Names: `editor.highlights[id]`. */
export const HIGHLIGHTS = [
  { id: "none", value: null },
  { id: "mint", value: "#dcf3e7" },
  { id: "yellow", value: "#fef3c7" },
] as const;

/** Keeps the editor selection when a control is clicked. */
export const keepSelection = (e: React.MouseEvent) => e.preventDefault();

export function IconButton({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={keepSelection}
      onClick={onClick}
      className={cn(
        "rounded-md p-1.5 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:pointer-events-none disabled:opacity-30",
        active && "bg-brand-soft text-brand hover:bg-brand-tint hover:text-brand",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

export function Divider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-zinc-200" aria-hidden />;
}

/** A toolbar button that opens a small panel below it; closes on outside click or Escape. */
export function Dropdown({
  title,
  trigger,
  active,
  disabled,
  align = "left",
  children,
}: {
  title: string;
  trigger: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  align?: "left" | "right";
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        title={title}
        aria-label={title}
        aria-expanded={open}
        disabled={disabled}
        onMouseDown={keepSelection}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1 rounded-md px-1.5 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-30",
          (open || active) && "bg-zinc-100 text-zinc-900",
        )}
      >
        {trigger}
        <ChevronDown className="size-3 text-zinc-400" />
      </button>
      {open && (
        <div
          className={cn(
            "absolute top-full z-30 mt-1.5 min-w-44 rounded-xl border border-zinc-200 bg-white p-1 shadow-xl",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon: Icon,
  label,
  hint,
  active,
  disabled,
  onClick,
}: {
  icon?: LucideIcon;
  label: React.ReactNode;
  hint?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={keepSelection}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-40",
        active && "bg-brand-soft font-semibold text-brand hover:bg-brand-soft",
      )}
    >
      {Icon && <Icon className="size-4 shrink-0" />}
      <span className="flex-1">{label}</span>
      {hint && <kbd className="font-sans text-[11px] text-zinc-400">{hint}</kbd>}
    </button>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{children}</p>;
}
