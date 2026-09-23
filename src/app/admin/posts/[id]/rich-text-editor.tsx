"use client";

import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import { useI18n } from "@/i18n/client";
import { imageFiles, uploadImage } from "@/lib/upload-client";
import type { EditorUi } from "./editor/blocks";
import { CalloutBubble, ImageBubble, TableBubble, TextBubble } from "./editor/bubbles";
import { buildExtensions, type SlashState } from "./editor/extensions";
import { SlashMenu } from "./editor/slash-menu";
import { Toolbar } from "./editor/toolbar";
import { UrlDialog, type UrlDialogConfig } from "./editor/url-dialog";

type Props = {
  content: JSONContent | null;
  onChange: (value: { json: JSONContent; html: string }) => void;
  siteId: string;
  onError: (message: string) => void;
  editable?: boolean;
};

const YOUTUBE_URL = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com\/(watch\?|shorts\/|embed\/)|youtu\.be\/)\S+$/;

export function RichTextEditor({ content, onChange, siteId, onError, editable = true }: Props) {
  const { t } = useI18n();
  const [uploading, setUploading] = useState(0);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [dialog, setDialog] = useState<UrlDialogConfig | null>(null);
  const fileInputId = useId();

  /** Uploads images one by one and inserts each where the paste or drop happened. */
  async function insertImages(editor: Editor, files: File[], at?: number) {
    let pos = at;
    for (const file of files) {
      setUploading((n) => n + 1);
      try {
        const image = await uploadImage(file, { siteId, networkError: t.editor.upload.network });
        const node = { type: "image", attrs: { src: image.url, alt: "", width: image.width, height: image.height } };
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

  const ui: EditorUi = {
    pickImage: () => document.getElementById(fileInputId)?.click(),
    promptImageUrl: (editor) =>
      setDialog({
        title: t.editor.urlDialog.imageTitle,
        description: t.editor.urlDialog.imageDescription,
        placeholder: t.editor.urlDialog.imagePlaceholder,
        withAlt: true,
        validate: (url) => (/^https?:\/\/\S+$/.test(url) ? null : t.editor.urlDialog.imageInvalid),
        onSubmit: (src, alt) => editor.chain().focus().setImage({ src, alt }).run(),
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

  const editor = useEditor({
    editable,
    extensions: buildExtensions({
      onFiles: (e, files, at) => void insertImages(e, files, at),
      onSlashState: setSlash,
      onSlashSelect: (item, e) => item.run(e, ui),
      onOpenLink: () => setLinkOpen(true),
      placeholders: { heading: t.editor.canvas.headingPlaceholder, paragraph: t.editor.canvas.paragraphPlaceholder },
    }),
    content: content ?? "",
    // Rendering on the server would not match the client and cause a hydration error.
    immediatelyRender: false,
    editorProps: { attributes: { class: "tiptap min-h-[60vh] outline-none" } },
    // ProseMirror builds attrs as prototype-less objects, which Server Actions silently drop;
    // a JSON round trip turns them into plain objects so levels, links and colours are saved.
    onUpdate: ({ editor }) => onChange({ json: JSON.parse(JSON.stringify(editor.getJSON())), html: editor.getHTML() }),
  });

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
          if (editor && files.length) void insertImages(editor, files);
        }}
      />
      <EditorContent editor={editor} className="mt-6" />
      {editor && <SlashMenu editor={editor} state={slash} />}
      {dialog && <UrlDialog config={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}
