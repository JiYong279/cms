"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import { useI18n } from "@/i18n/client";
import { imageFiles, uploadImage } from "@/lib/upload-client";
import type { EditorUi } from "./editor/blocks";
import { CalloutBubble, ImageBubble, TableBubble, TextBubble } from "./editor/bubbles";
import { buildExtensions, type SlashState } from "./editor/extensions";
import { SlashMenu } from "./editor/slash-menu";
import { Toolbar } from "./editor/toolbar";
import { StockDialog } from "./editor/stock-dialog";
import { UrlDialog, type UrlDialogConfig } from "./editor/url-dialog";

type Props = {
  content: JSONContent | null;
  onChange: (value: { json: JSONContent; html: string }) => void;
  siteId: string;
  onError: (message: string) => void;
  editable?: boolean;
  /** Replaces the whole document with this HTML (e.g. an AI draft) each time `version` changes. */
  replacement?: { html: string; version: number } | null;
  /** The article's language: stock photo searches use it. */
  locale: "vi" | "en";
  /** Receives the editor once it exists, for changes made from outside (confirming image rights). */
  editorRef?: React.RefObject<Editor | null>;
};

const YOUTUBE_URL = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com\/(watch\?|shorts\/|embed\/)|youtu\.be\/)\S+$/;

export function RichTextEditor({ content, onChange, siteId, locale, onError, editable = true, replacement, editorRef }: Props) {
  const { t } = useI18n();
  const [uploading, setUploading] = useState(0);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [dialog, setDialog] = useState<UrlDialogConfig | null>(null);
  const fileInputId = useId();
  // The image suggestion waiting for the file being picked, to put the upload in its place.
  const [suggestionAt, setSuggestionAt] = useState<number | null>(null);

  // The stock photo picker: for an image suggestion (its position) or the cursor (null).
  const [stock, setStock] = useState<{ pos: number | null; query: string } | null>(null);

  /** Puts a real image where a suggestion was, with the suggestion's description and caption. */
  function replaceSuggestion(editor: Editor, pos: number, image: { src: string; width?: number; height?: number; rights: string; credit?: string }) {
    const node = editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== "imageSuggestion") return;
    const attrs = { ...image, alt: node.attrs.alt as string, title: node.attrs.caption as string };
    editor.chain().focus().insertContentAt({ from: pos, to: pos + node.nodeSize }, { type: "image", attrs }).run();
  }

  /** Uploads images one by one and inserts each where the paste or drop happened. */
  async function insertImages(editor: Editor, files: File[], at?: number) {
    let pos = at;
    for (const file of files) {
      setUploading((n) => n + 1);
      try {
        const image = await uploadImage(file, { siteId, networkError: t.editor.upload.network });
        const node = { type: "image", attrs: { src: image.url, alt: "", width: image.width, height: image.height, rights: "own" } };
        const target = Math.min(pos ?? editor.state.selection.to, editor.state.doc.content.size);
        editor.chain().focus().insertContentAt(target, node).run();
        pos = editor.state.selection.to;
      } catch (error) {
        onError(error instanceof Error ? error.message : t.editor.upload.failed);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  /** Uploads one image into the place of an image suggestion. */
  async function uploadInto(editor: Editor, file: File, pos: number) {
    setUploading((n) => n + 1);
    try {
      const image = await uploadImage(file, { siteId, networkError: t.editor.upload.network });
      replaceSuggestion(editor, pos, { src: image.url, width: image.width, height: image.height, rights: "own" });
    } catch (error) {
      onError(error instanceof Error ? error.message : t.editor.upload.failed);
    } finally {
      setUploading((n) => n - 1);
    }
  }

  const ui: EditorUi = {
    pickStock: () => setStock({ pos: null, query: "" }),
    pickImage: () => {
      // A suggestion whose file picker was cancelled must not catch this upload.
      setSuggestionAt(null);
      document.getElementById(fileInputId)?.click();
    },
    promptImageUrl: (editor) =>
      setDialog({
        title: t.editor.urlDialog.imageTitle,
        description: t.editor.urlDialog.imageDescription,
        placeholder: t.editor.urlDialog.imagePlaceholder,
        withAlt: true,
        validate: (url) => (/^https?:\/\/\S+$/.test(url) ? null : t.editor.urlDialog.imageInvalid),
        onSubmit: (src, alt) => editor.chain().focus().insertContent({ type: "image", attrs: { src, alt, rights: "unknown" } }).run(),
      }),
    promptYoutube: (editor) =>
      setDialog({
        title: t.editor.urlDialog.youtubeTitle,
        description: t.editor.urlDialog.youtubeDescription,
        placeholder: "https://www.youtube.com/watch?v=…",
        validate: (url) => (YOUTUBE_URL.test(url) ? null : t.editor.urlDialog.youtubeInvalid),
        onSubmit: (src) => {
          if (!editor.chain().focus().setYoutubeVideo({ src }).run()) onError(t.editor.urlDialog.youtubeFailed);
        },
      }),
  };

  // True while the loaded document settles (see onCreate): changes made then are not the person's.
  const settling = useRef(true);

  const editor = useEditor({
    editable,
    extensions: buildExtensions({
      onFiles: (e, files, at) => void insertImages(e, files, at),
      onSuggestion: (e, pos, action) => {
        if (action === "stock") {
          setStock({ pos, query: (e.state.doc.nodeAt(pos)?.attrs.description as string | undefined) ?? "" });
          return;
        }
        if (action === "upload") {
          setSuggestionAt(pos);
          document.getElementById(fileInputId)?.click();
          return;
        }
        setDialog({
          title: t.editor.urlDialog.imageTitle,
          description: t.editor.urlDialog.imageDescription,
          placeholder: t.editor.urlDialog.imagePlaceholder,
          validate: (url) => (/^https?:\/\/\S+$/.test(url) ? null : t.editor.urlDialog.imageInvalid),
          // Linked from elsewhere: nobody has checked yet whether it may be used.
          onSubmit: (src) => replaceSuggestion(e, pos, { src, rights: "unknown" }),
        });
      },
      onSlashState: setSlash,
      onSlashSelect: (item, e) => item.run(e, ui),
      onOpenLink: () => setLinkOpen(true),
      placeholders: { heading: t.editor.canvas.headingPlaceholder, paragraph: t.editor.canvas.paragraphPlaceholder },
    }),
    content: content ?? "",
    // Rendering on the server would not match the client and cause a hydration error.
    immediatelyRender: false,
    editorProps: { attributes: { class: "tiptap min-h-[60vh] outline-none" } },
    // Plugins adjust a loaded document on its first transaction (e.g. a paragraph after a closing
    // heading, as a planned draft's outline ends). Left for later, that happens on the first focus,
    // such as closing the AI dialog, and reads as an unsaved edit that blocks leaving the page.
    onCreate: ({ editor }) => {
      editor.view.dispatch(editor.state.tr);
      settling.current = false;
    },
    // ProseMirror builds attrs as prototype-less objects, which Server Actions silently drop;
    // a JSON round trip turns them into plain objects so levels, links and colours are saved.
    onUpdate: ({ editor }) => {
      if (settling.current) return;
      onChange({ json: JSON.parse(JSON.stringify(editor.getJSON())), html: editor.getHTML() });
    },
  });

  // Parsed by the editor like a paste, so anything it does not support is dropped; onUpdate reports it.
  useEffect(() => {
    if (!editor || !replacement) return;
    // After React's commit: blocks drawn by React (image suggestions) cannot render inside it.
    const timer = setTimeout(() => editor.commands.setContent(replacement.html), 0);
    return () => clearTimeout(timer);
  }, [editor, replacement]);

  useEffect(() => {
    if (editorRef) editorRef.current = editor;
  }, [editor, editorRef]);

  const toolbar = editor && (
    <Toolbar
      editor={editor}
      ui={ui}
      uploading={uploading}
      disabled={!editable}
      linkOpen={linkOpen}
      onLinkOpenChange={setLinkOpen}
    />
  );
  // The page provides a full-width slot under its header; without one the toolbar sits above the text.
  const toolbarSlot = editor ? document.getElementById("editor-toolbar") : null;

  return (
    <div className="relative">
      {editor ? (
        <>
          {toolbarSlot ? createPortal(toolbar, toolbarSlot) : toolbar}
          <TextBubble editor={editor} />
          <ImageBubble editor={editor} />
          <TableBubble editor={editor} />
          <CalloutBubble editor={editor} />
        </>
      ) : (
        <div className="h-12" />
      )}
      <input
        id={fileInputId}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        multiple
        hidden
        onChange={(e) => {
          const files = imageFiles(e.target.files);
          e.target.value = "";
          const at = suggestionAt;
          setSuggestionAt(null);
          if (editor && files.length && at !== null) void uploadInto(editor, files[0], at);
          else if (editor && files.length) void insertImages(editor, files);
        }}
      />
      <EditorContent editor={editor} className="mt-6" />
      {editor && <SlashMenu editor={editor} state={slash} />}
      {dialog && <UrlDialog config={dialog} onClose={() => setDialog(null)} />}
      {stock && editor && (
        <StockDialog
          siteId={siteId}
          locale={locale}
          initialQuery={stock.query}
          onClose={() => setStock(null)}
          onPick={(image) => {
            const attrs = { src: image.url, width: image.width, height: image.height, rights: "stock", credit: image.credit };
            if (stock.pos !== null) replaceSuggestion(editor, stock.pos, attrs);
            else editor.chain().focus().insertContent({ type: "image", attrs: { ...attrs, alt: image.alt } }).run();
            setStock(null);
          }}
        />
      )}
    </div>
  );
}
