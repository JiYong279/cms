"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type { BlockItem } from "./blocks";
import type { Editor } from "@tiptap/react";
import { setSlashKeyHandler, type SlashState } from "./extensions";

type Props = {
  editor: Editor;
  state: SlashState | null;
};

const MENU_HEIGHT = 320;
const NO_ITEMS: BlockItem[] = [];

export function SlashMenu({ editor, state }: Props) {
  const { t } = useI18n();
  const items = state?.items ?? NO_ITEMS;
  const [index, setIndex] = useState(0);
  // Start from the top whenever the list changes (a new "/" or more letters typed).
  const [shownItems, setShownItems] = useState(items);
  if (shownItems !== items) {
    setShownItems(items);
    setIndex(0);
  }
  const active = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!state) return;
    setSlashKeyHandler(editor, (event) => {
      if (!state || items.length === 0) return false;
      if (event.key === "ArrowDown") {
        setIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setIndex((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        state.select(items[index]);
        return true;
      }
      return false;
    });
    return () => setSlashKeyHandler(editor, null);
  }, [editor, state, items, index]);

  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest" });
  }, [index]);

  // After a space with nothing matching, the user is just writing prose: step aside.
  if (!state?.rect || (items.length === 0 && /\s/.test(state.query))) return null;
  const below = state.rect.bottom + 6 + MENU_HEIGHT < window.innerHeight;
  const style = {
    left: Math.min(state.rect.left, window.innerWidth - 300),
    ...(below ? { top: state.rect.bottom + 6 } : { bottom: window.innerHeight - state.rect.top + 6 }),
  };

  return (
    <div
      style={style}
      className="fixed z-50 w-72 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl"
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-zinc-500">{t.editor.slash.empty}</p>
      ) : (
        <div className="max-h-80 overflow-y-auto p-1" role="listbox">
          {items.map((item: BlockItem, i) => {
            const newGroup = i === 0 || items[i - 1].group !== item.group;
            return (
              <div key={item.id}>
                {newGroup && (
                  <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{t.editor.groups[item.group]}</p>
                )}
                <button
                  ref={i === index ? active : undefined}
                  type="button"
                  role="option"
                  aria-selected={i === index}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => state.select(item)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left",
                    i === index ? "bg-brand-soft" : "hover:bg-zinc-50",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg border bg-white",
                      i === index ? "border-brand-light text-brand" : "border-zinc-200 text-zinc-600",
                    )}
                  >
                    <item.icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-zinc-800">{t.editor.blocks[item.id].label}</span>
                    <span className="block truncate text-xs text-zinc-500">{t.editor.blocks[item.id].description}</span>
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
      <p className="border-t border-zinc-100 px-3 py-1.5 text-[11px] text-zinc-400">{t.editor.slash.help}</p>
    </div>
  );
}
