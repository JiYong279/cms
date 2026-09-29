"use client";

import { useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Bold,
  CheckCircle2,
  Code,
  Highlighter,
  Info,
  Italic,
  Link2,
  Link2Off,
  PanelTop,
  Strikethrough,
  Trash2,
  Underline,
  Columns3,
  Rows3,
  Ungroup,
} from "lucide-react";
import { useI18n } from "@/i18n/client";
import { IMAGE_RIGHTS } from "@/lib/image-rights";
import { cn } from "@/lib/utils";
import type { CalloutVariant } from "./extensions";
import { Divider, IconButton } from "./ui";

// Tiptap sets `width: max-content` inline; max-width keeps menus on narrow screens.
const menuClass = "flex max-w-[calc(100vw-1rem)] flex-wrap items-center gap-0.5 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg";

/** Formatting and link editing next to the selected text. */
export function TextBubble({ editor }: { editor: Editor }) {
  const { t } = useI18n();
  const b = t.editor.bubbles;
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      highlight: e.isActive("highlight"),
      link: e.isActive("link"),
      href: (e.getAttributes("link").href as string | undefined) ?? "",
    }),
  });
  const chain = () => editor.chain().focus();

  function applyLink() {
    const url = linkDraft?.trim() ?? "";
    if (url) chain().extendMarkRange("link").setLink({ href: url }).run();
    else chain().extendMarkRange("link").unsetLink().run();
    setLinkDraft(null);
  }

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="textBubble"
      shouldShow={({ editor: e, from, to }) =>
        from !== to && !e.isActive("image") && !e.isActive("codeBlock") && !e.isActive("youtube")
      }
      options={{ placement: "top", offset: 8, shift: { padding: 8 }, onHide: () => setLinkDraft(null) }}
      className={menuClass}
    >
      {linkDraft === null ? (
        <>
          <IconButton icon={Bold} label={b.bold} active={s.bold} onClick={() => chain().toggleBold().run()} />
          <IconButton icon={Italic} label={b.italic} active={s.italic} onClick={() => chain().toggleItalic().run()} />
          <IconButton icon={Underline} label={b.underline} active={s.underline} onClick={() => chain().toggleUnderline().run()} />
          <IconButton icon={Strikethrough} label={b.strike} active={s.strike} onClick={() => chain().toggleStrike().run()} />
          <IconButton icon={Code} label={b.code} active={s.code} onClick={() => chain().toggleCode().run()} />
          <IconButton
            icon={Highlighter}
            label={b.highlight}
            active={s.highlight}
            onClick={() => (s.highlight ? chain().unsetHighlight().run() : chain().setHighlight({ color: "#dcf3e7" }).run())}
          />
          <Divider />
          <IconButton icon={Link2} label={b.link} active={s.link} onClick={() => setLinkDraft(s.href)} />
          {s.link && <IconButton icon={Link2Off} label={b.unlink} onClick={() => chain().extendMarkRange("link").unsetLink().run()} />}
        </>
      ) : (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            applyLink();
          }}
        >
          <input
            autoFocus
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setLinkDraft(null);
                editor.commands.focus();
              }
            }}
            placeholder={b.linkPlaceholder}
            className="w-64 rounded-md border border-zinc-200 px-2 py-1 text-sm outline-none focus:border-brand"
          />
          <button type="submit" className="rounded-md bg-brand px-2.5 py-1 text-xs font-semibold text-white">
            {t.common.save}
          </button>
        </form>
      )}
    </BubbleMenu>
  );
}

/** Alt text, caption and removal for the selected image. */
export function ImageBubble({ editor }: { editor: Editor }) {
  const { t } = useI18n();
  const b = t.editor.bubbles;
  const attrs = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e.isActive("image")
        ? {
            alt: (e.getAttributes("image").alt as string | undefined) ?? "",
            title: (e.getAttributes("image").title as string | undefined) ?? "",
            credit: (e.getAttributes("image").credit as string | undefined) ?? "",
            rights: (e.getAttributes("image").rights as string | undefined) ?? "",
          }
        : { alt: "", title: "", credit: "", rights: "" },
  });

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="imageBubble"
      shouldShow={({ editor: e }) => e.isActive("image")}
      options={{ placement: "bottom", offset: 8, shift: { padding: 8 } }}
      className="flex w-[26rem]! max-w-[calc(100vw-1rem)] flex-col gap-1.5 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg"
    >
      <label className="flex items-center gap-2 text-xs text-zinc-500">
        <span className="w-16 shrink-0">{b.alt}</span>
        <input
          value={attrs.alt}
          onChange={(e) => editor.commands.updateAttributes("image", { alt: e.target.value })}
          placeholder={b.altPlaceholder}
          className={cn(
            "min-w-0 flex-1 rounded-md border px-2 py-1 text-sm text-zinc-800 outline-none focus:border-brand",
            attrs.alt ? "border-zinc-200" : "border-amber-300 bg-amber-50/60",
          )}
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-zinc-500">
        <span className="w-16 shrink-0">{b.caption}</span>
        <input
          value={attrs.title}
          onChange={(e) => editor.commands.updateAttributes("image", { title: e.target.value })}
          placeholder={b.captionPlaceholder}
          className="min-w-0 flex-1 rounded-md border border-zinc-200 px-2 py-1 text-sm text-zinc-800 outline-none focus:border-brand"
        />
        <IconButton icon={Trash2} label={b.deleteImage} onClick={() => editor.chain().focus().deleteSelection().run()} />
      </label>
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <span className="w-16 shrink-0">{b.source}</span>
        <select
          value={attrs.rights}
          aria-label={b.rights}
          data-image-rights
          onChange={(e) => editor.commands.updateAttributes("image", { rights: e.target.value })}
          className={cn(
            "rounded-md border px-1.5 py-1 text-xs text-zinc-800 outline-none focus:border-brand",
            attrs.rights === "unknown" ? "border-amber-400 bg-amber-50" : "border-zinc-200",
          )}
        >
          <option value="">{b.rightsUnset}</option>
          {IMAGE_RIGHTS.map((r) => (
            <option key={r} value={r}>
              {b.rightsOptions[r]}
            </option>
          ))}
        </select>
        <input
          value={attrs.credit}
          aria-label={b.credit}
          onChange={(e) => editor.commands.updateAttributes("image", { credit: e.target.value })}
          placeholder={b.creditPlaceholder}
          className="min-w-0 flex-1 rounded-md border border-zinc-200 px-2 py-1 text-sm text-zinc-800 outline-none focus:border-brand"
        />
      </div>
      {attrs.rights === "unknown" && <p className="px-1 text-[11px] leading-snug text-amber-700">{b.unknownHint}</p>}
    </BubbleMenu>
  );
}

/** Row and column controls while the cursor is in a table. */
export function TableBubble({ editor }: { editor: Editor }) {
  const { t } = useI18n();
  const b = t.editor.bubbles;
  const chain = () => editor.chain().focus();
  const caption = useEditorState({
    editor,
    selector: ({ editor: e }) => (e.isActive("table") ? ((e.getAttributes("table").caption as string | undefined) ?? "") : ""),
  });
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableBubble"
      shouldShow={({ editor: e, from, to }) => e.isActive("table") && from === to}
      options={{ placement: "top", offset: 8, shift: { padding: 8 } }}
      className={cn(menuClass, "flex-col items-stretch gap-1")}
    >
      <label className="flex items-center gap-2 px-1.5 pt-0.5 text-xs text-zinc-500">
        <span className="shrink-0 font-medium">{b.tableCaption}</span>
        <input
          value={caption}
          data-table-caption
          onChange={(e) => editor.commands.updateAttributes("table", { caption: e.target.value })}
          placeholder={b.tableCaptionPlaceholder}
          className="min-w-0 flex-1 rounded-md border border-zinc-200 px-2 py-1 text-sm text-zinc-800 outline-none focus:border-brand"
        />
      </label>
      <div className="flex flex-wrap items-center gap-0.5">
      <span className="flex items-center gap-1 px-1.5 text-xs font-medium text-zinc-500">
        <Rows3 className="size-3.5" /> {b.rows}
      </span>
      <IconButton icon={ArrowUpToLine} label={b.rowAbove} onClick={() => chain().addRowBefore().run()} />
      <IconButton icon={ArrowDownToLine} label={b.rowBelow} onClick={() => chain().addRowAfter().run()} />
      <IconButton icon={Trash2} label={b.deleteRow} onClick={() => chain().deleteRow().run()} />
      <Divider />
      <span className="flex items-center gap-1 px-1.5 text-xs font-medium text-zinc-500">
        <Columns3 className="size-3.5" /> {b.columns}
      </span>
      <IconButton icon={ArrowLeftToLine} label={b.columnLeft} onClick={() => chain().addColumnBefore().run()} />
      <IconButton icon={ArrowRightToLine} label={b.columnRight} onClick={() => chain().addColumnAfter().run()} />
      <IconButton icon={Trash2} label={b.deleteColumn} onClick={() => chain().deleteColumn().run()} />
      <Divider />
      <IconButton icon={PanelTop} label={b.toggleHeaderRow} onClick={() => chain().toggleHeaderRow().run()} />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => chain().deleteTable().run()}
        className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
      >
        {b.deleteTable}
      </button>
      </div>
    </BubbleMenu>
  );
}

/** Labels: `editor.bubbles.callout[value]`. */
const VARIANTS: { value: CalloutVariant; icon: typeof Info }[] = [
  { value: "info", icon: Info },
  { value: "success", icon: CheckCircle2 },
  { value: "warning", icon: AlertTriangle },
];

/** Style switcher while the cursor is inside a callout box. */
export function CalloutBubble({ editor }: { editor: Editor }) {
  const { t } = useI18n();
  const variant = useEditorState({
    editor,
    selector: ({ editor: e }) => (e.getAttributes("callout").variant as CalloutVariant | undefined) ?? "info",
  });
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="calloutBubble"
      shouldShow={({ editor: e, from, to }) => e.isActive("callout") && from === to}
      options={{ placement: "top-start", offset: 8, shift: { padding: 8 } }}
      className={menuClass}
    >
      {VARIANTS.map((v) => (
        <button
          key={v.value}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().updateAttributes("callout", { variant: v.value }).run()}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100",
            variant === v.value && "bg-brand-soft text-brand",
          )}
        >
          <v.icon className="size-3.5" />
          {t.editor.bubbles.callout[v.value]}
        </button>
      ))}
      <Divider />
      <IconButton icon={Ungroup} label={t.editor.bubbles.unwrapCallout} onClick={() => editor.chain().focus().lift("callout").run()} />
    </BubbleMenu>
  );
}
