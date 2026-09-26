"use client";

import { useEffect, useRef, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Code,
  Heading2,
  Heading3,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Keyboard,
  Link2,
  List,
  ListOrdered,
  MessageSquareText,
  Loader2,
  Pilcrow,
  Plus,
  Redo2,
  RemoveFormatting,
  SquareDashed,
  Strikethrough,
  Underline,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { plural } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { BLOCKS, type EditorUi } from "./blocks";
import type { CalloutVariant } from "./extensions";
import { Divider, Dropdown, HIGHLIGHTS, IconButton, MenuItem, MenuLabel, TEXT_COLORS, keepSelection } from "./ui";

/**
 * The plain text box (marked data-undo-field: the title and the excerpt) the person last typed in, or
 * null while they work in the article body or anywhere else. Clicks on the toolbar do not change it.
 */
function usePlainFieldFocus(editor: Editor) {
  const [field, setField] = useState<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const onFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.closest('[role="toolbar"]')) return;
      setField(target instanceof HTMLTextAreaElement && target.hasAttribute("data-undo-field") ? target : null);
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, [editor]);
  return field;
}

/** Labels: `editor.toolbar.align[value]`. */
const ALIGNMENTS: { value: "left" | "center" | "right" | "justify"; icon: LucideIcon }[] = [
  { value: "left", icon: AlignLeft },
  { value: "center", icon: AlignCenter },
  { value: "right", icon: AlignRight },
  { value: "justify", icon: AlignJustify },
];

/** The callout boxes, with the icons the "Insert" menu uses. */
const CALLOUTS = (["info", "success", "warning"] as const).map((variant) => {
  const id = `callout-${variant}` as const;
  return { variant, id, icon: BLOCKS.find((b) => b.id === id)!.icon };
});

type Props = {
  editor: Editor;
  ui: EditorUi;
  uploading: number;
  disabled: boolean;
  linkOpen: boolean;
  onLinkOpenChange: (open: boolean) => void;
};

export function Toolbar({ editor, ui, uploading, disabled, linkOpen, onLinkOpenChange }: Props) {
  const { t } = useI18n();
  const tb = t.editor.toolbar;
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      color: (e.getAttributes("textStyle").color as string | undefined) ?? null,
      highlight: (e.getAttributes("highlight").color as string | undefined) ?? null,
      align: ALIGNMENTS.find((a) => e.isActive({ textAlign: a.value }))?.value ?? "left",
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      canSink: e.can().sinkListItem("listItem"),
      canLift: e.can().liftListItem("listItem"),
      callout: e.isActive("callout") ? ((e.getAttributes("callout").variant as CalloutVariant | undefined) ?? "info") : null,
    }),
  });
  const chain = () => editor.chain().focus();
  const plainField = usePlainFieldFocus(editor);
  /**
   * Undo/Redo follow where the person is typing. The title and the excerpt are plain text boxes with
   * the browser's own history, which only execCommand can reach (deprecated, but still the one way to
   * step through it, and supported by every current browser).
   */
  const history = (step: "undo" | "redo") => {
    if (plainField) {
      plainField.focus();
      document.execCommand(step);
    } else {
      chain()[step]().run();
    }
  };
  const blockLabel = t.editor.blocks[s.h2 ? "h2" : s.h3 ? "h3" : "paragraph"].label;
  const AlignIcon = ALIGNMENTS.find((a) => a.value === s.align)?.icon ?? AlignLeft;

  return (
    <div className="px-3 py-1.5">
      <div
        role="toolbar"
        aria-label={tb.label}
        className={cn(
          "mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-0.5",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <IconButton icon={Undo2} label={tb.undo} disabled={!plainField && !s.canUndo} onClick={() => history("undo")} />
        <IconButton icon={Redo2} label={tb.redo} disabled={!plainField && !s.canRedo} onClick={() => history("redo")} />
        <Divider />

        <Dropdown title={tb.blockType} trigger={<span className="w-[5.5rem] text-left text-[13px] font-medium">{blockLabel}</span>}>
          {(close) => (
            <>
              <MenuItem icon={Pilcrow} label={t.editor.blocks.paragraph.label} active={!s.h2 && !s.h3} onClick={() => (chain().setParagraph().run(), close())} />
              <MenuItem icon={Heading2} label={t.editor.blocks.h2.label} hint="##" active={s.h2} onClick={() => (chain().setHeading({ level: 2 }).run(), close())} />
              <MenuItem icon={Heading3} label={t.editor.blocks.h3.label} hint="###" active={s.h3} onClick={() => (chain().setHeading({ level: 3 }).run(), close())} />
            </>
          )}
        </Dropdown>
        <Divider />

        <IconButton icon={Bold} label={tb.bold} active={s.bold} onClick={() => chain().toggleBold().run()} />
        <IconButton icon={Italic} label={tb.italic} active={s.italic} onClick={() => chain().toggleItalic().run()} />
        <IconButton icon={Underline} label={tb.underline} active={s.underline} onClick={() => chain().toggleUnderline().run()} />
        <IconButton icon={Strikethrough} label={tb.strike} active={s.strike} onClick={() => chain().toggleStrike().run()} />
        <IconButton icon={Code} label={tb.code} active={s.code} onClick={() => chain().toggleCode().run()} />
        <Dropdown
          title={tb.colors}
          active={!!s.color || !!s.highlight}
          trigger={
            <span className="flex flex-col items-center">
              <Baseline className="size-4" />
              <span className="-mt-0.5 h-0.5 w-3.5 rounded" style={{ background: s.color ?? s.highlight ?? "transparent" }} />
            </span>
          }
        >
          {(close) => (
            <div className="w-56 p-1">
              <MenuLabel>{tb.textColor}</MenuLabel>
              <Swatches
                items={TEXT_COLORS}
                labels={t.editor.colors}
                current={s.color}
                kind="text"
                onPick={(value) => {
                  if (value) chain().setColor(value).run();
                  else chain().unsetColor().run();
                  close();
                }}
              />
              <MenuLabel>{tb.highlight}</MenuLabel>
              <Swatches
                items={HIGHLIGHTS}
                labels={t.editor.highlights}
                current={s.highlight}
                kind="highlight"
                onPick={(value) => {
                  if (value) chain().setHighlight({ color: value }).run();
                  else chain().unsetHighlight().run();
                  close();
                }}
              />
            </div>
          )}
        </Dropdown>
        <LinkControl editor={editor} active={s.link} open={linkOpen} onOpenChange={onLinkOpenChange} />
        <Divider />

        <Dropdown title={tb.alignment} trigger={<AlignIcon className="size-4" />}>
          {(close) =>
            ALIGNMENTS.map((a) => (
              <MenuItem
                key={a.value}
                icon={a.icon}
                label={tb.align[a.value]}
                active={s.align === a.value}
                onClick={() => (chain().setTextAlign(a.value).run(), close())}
              />
            ))
          }
        </Dropdown>
        <IconButton icon={List} label={tb.bulletList} active={s.bulletList} onClick={() => chain().toggleBulletList().run()} />
        <IconButton icon={ListOrdered} label={tb.orderedList} active={s.orderedList} onClick={() => chain().toggleOrderedList().run()} />
        <IconButton icon={IndentIncrease} label={tb.indent} disabled={!s.canSink} onClick={() => chain().sinkListItem("listItem").run()} />
        <IconButton icon={IndentDecrease} label={tb.outdent} disabled={!s.canLift} onClick={() => chain().liftListItem("listItem").run()} />
        <Dropdown title={tb.callout} active={!!s.callout} trigger={<MessageSquareText className="size-4" />}>
          {(close) => (
            <div className="w-56">
              <MenuLabel>{tb.callout}</MenuLabel>
              {CALLOUTS.map((c) => (
                <MenuItem
                  key={c.variant}
                  icon={c.icon}
                  label={t.editor.blocks[c.id].label}
                  active={s.callout === c.variant}
                  onClick={() => {
                    // Inside a box: change its kind; otherwise put the current paragraph in one.
                    if (s.callout) chain().updateAttributes("callout", { variant: c.variant }).run();
                    else chain().wrapIn("callout", { variant: c.variant }).run();
                    close();
                  }}
                />
              ))}
              {s.callout && (
                <MenuItem icon={SquareDashed} label={tb.removeCallout} onClick={() => (chain().lift("callout").run(), close())} />
              )}
            </div>
          )}
        </Dropdown>
        <Divider />

        <Dropdown
          title={tb.insert}
          trigger={
            <span className="flex items-center gap-1 text-[13px] font-semibold text-brand">
              <Plus className="size-4" />
              {tb.insert}
            </span>
          }
        >
          {(close) => (
            <div className="max-h-[60vh] w-64 overflow-y-auto">
              {(["media", "blocks", "text"] as const).map((group) => (
                <div key={group}>
                  <MenuLabel>{t.editor.groups[group]}</MenuLabel>
                  {BLOCKS.filter((b) => b.group === group && b.id !== "paragraph").map((b) => (
                    <MenuItem
                      key={b.id}
                      icon={b.icon}
                      label={t.editor.blocks[b.id].label}
                      onClick={() => {
                        close();
                        b.run(editor, ui);
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </Dropdown>
        <IconButton
          icon={RemoveFormatting}
          label={tb.clearFormatting}
          onClick={() => chain().unsetAllMarks().clearNodes().unsetTextAlign().run()}
        />

        {uploading > 0 && (
          <span className="ml-1 flex items-center gap-1.5 rounded-md bg-brand-soft px-2 py-1 text-xs font-medium text-brand">
            <Loader2 className="size-3.5 animate-spin" />
            {plural(uploading, tb.uploadingOne, tb.uploadingOther)}
          </span>
        )}
        <Divider />
        <Dropdown title={tb.shortcuts} align="right" trigger={<Keyboard className="size-4" />}>
          {() => (
            <div className="w-80 p-2">
              <MenuLabel>{tb.shortcuts}</MenuLabel>
              <dl className="mt-1 space-y-1.5 px-2.5 pb-1 text-xs">
                {tb.shortcutList.map(({ what, keys }) => (
                  <div key={what} className="flex justify-between gap-4">
                    <dt className="text-zinc-600">{what}</dt>
                    <dd className="shrink-0 font-mono text-zinc-500">{keys}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </Dropdown>
      </div>
    </div>
  );
}

function Swatches<Id extends string>({
  items,
  labels,
  current,
  kind,
  onPick,
}: {
  items: readonly { id: Id; value: string | null }[];
  /** Swatch names by id, in the interface language. */
  labels: Record<Id, string>;
  current: string | null;
  kind: "text" | "highlight";
  onPick: (value: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 px-2.5 pb-2 pt-1">
      {items.map((c) => (
        <button
          key={c.id}
          type="button"
          title={labels[c.id]}
          aria-label={labels[c.id]}
          onMouseDown={keepSelection}
          onClick={() => onPick(c.value)}
          className={cn(
            "flex size-7 items-center justify-center rounded-md border text-sm font-bold",
            current === c.value || (!current && !c.value) ? "border-brand ring-2 ring-brand/20" : "border-zinc-200 hover:border-zinc-400",
          )}
          style={kind === "text" ? { color: c.value ?? "#424245" } : { background: c.value ?? "#fff" }}
        >
          {kind === "text" ? "A" : c.value ? "" : "∅"}
        </button>
      ))}
    </div>
  );
}

/** Link editor on the toolbar; also opened with Ctrl+K. Without a selection it inserts the URL as text. */
function LinkControl({
  editor,
  active,
  open,
  onOpenChange,
}: {
  editor: Editor;
  active: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onOpenChange]);

  function openEditor() {
    setUrl((editor.getAttributes("link").href as string | undefined) ?? "");
    onOpenChange(!open);
  }

  function apply() {
    const href = url.trim();
    const chain = editor.chain().focus();
    if (!href) chain.extendMarkRange("link").unsetLink().run();
    else if (editor.state.selection.empty && !editor.isActive("link")) {
      chain.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
    } else chain.extendMarkRange("link").setLink({ href }).run();
    onOpenChange(false);
  }

  return (
    <div ref={root} className="relative">
      <IconButton icon={Link2} label={t.editor.toolbar.link} active={active || open} onClick={openEditor} />
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
          className="absolute left-1/2 top-full z-30 mt-1.5 flex w-80 -translate-x-1/2 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl"
        >
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onOpenChange(false);
                editor.commands.focus();
              }
            }}
            placeholder={t.editor.toolbar.linkPlaceholder}
            className="min-w-0 flex-1 rounded-md border border-zinc-200 px-2 py-1 text-sm outline-none focus:border-brand"
          />
          <button type="submit" className="rounded-md bg-brand px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-hover">
            {t.common.save}
          </button>
          {active && (
            <button
              type="button"
              onClick={() => {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
                onOpenChange(false);
              }}
              className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              {t.editor.toolbar.removeLink}
            </button>
          )}
        </form>
      )}
    </div>
  );
}
