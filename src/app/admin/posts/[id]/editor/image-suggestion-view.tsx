"use client";

import { NodeViewWrapper, type Editor, type ReactNodeViewProps } from "@tiptap/react";
import { ImageIcon, ImagePlus, Link2, Trash2, Upload } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type { SuggestionAction } from "./extensions";

/**
 * An image suggestion in the editor: what the picture should show, its description and caption ready,
 * and buttons to put a real image in its place. Never published (lib/image-suggestions).
 */
export function ImageSuggestionView({ node, getPos, editor, extension, deleteNode, selected }: ReactNodeViewProps) {
  const { t } = useI18n();
  const s = t.editor.suggestion;
  const onAction = extension.options.onAction as (editor: Editor, pos: number, action: SuggestionAction) => void;
  const act = (action: SuggestionAction) => {
    const pos = getPos();
    if (typeof pos === "number") onAction(editor, pos, action);
  };
  const button = "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition";

  return (
    <NodeViewWrapper
      data-image-suggestion-view=""
      contentEditable={false}
      className={cn("my-6 rounded-2xl border-2 border-dashed border-brand-light bg-brand-soft/30 p-4", selected && "ring-2 ring-brand-bright/40")}
    >
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand">
        <ImagePlus className="size-4" />
        {s.title}
      </p>
      <p className="mt-2 text-sm font-medium text-zinc-800">{node.attrs.description as string}</p>
      <dl className="mt-2 grid gap-0.5 text-xs text-zinc-500">
        {node.attrs.alt && (
          <div className="flex gap-1.5">
            <dt className="font-semibold">{s.alt}:</dt>
            <dd>{node.attrs.alt as string}</dd>
          </div>
        )}
        {node.attrs.caption && (
          <div className="flex gap-1.5">
            <dt className="font-semibold">{s.caption}:</dt>
            <dd>{node.attrs.caption as string}</dd>
          </div>
        )}
      </dl>
      {editor.isEditable && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => act("upload")} className={cn(button, "border-brand bg-brand text-white hover:bg-brand-hover")}>
            <Upload className="size-3.5" />
            {s.upload}
          </button>
          <button type="button" onClick={() => act("stock")} className={cn(button, "border-brand bg-white text-brand hover:bg-brand-soft")}>
            <ImageIcon className="size-3.5" />
            {s.stock}
          </button>
          <button type="button" onClick={() => act("link")} className={cn(button, "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400")}>
            <Link2 className="size-3.5" />
            {s.link}
          </button>
          <button type="button" onClick={() => deleteNode()} className={cn(button, "border-transparent text-zinc-500 hover:bg-red-50 hover:text-red-600")}>
            <Trash2 className="size-3.5" />
            {s.remove}
          </button>
        </div>
      )}
    </NodeViewWrapper>
  );
}
