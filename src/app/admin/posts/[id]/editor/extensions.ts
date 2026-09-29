import { Extension, Node, mergeAttributes, type Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import { Table, TableKit } from "@tiptap/extension-table";
import Youtube from "@tiptap/extension-youtube";
import Suggestion from "@tiptap/suggestion";
import { imageFiles } from "@/lib/upload-client";
import { filterBlocks, type BlockItem } from "./blocks";

/** Images carry who to credit and whether they may be used (lib/image-rights), as data-* attributes. */
const CreditedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      credit: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-credit") ?? "",
        renderHTML: (attrs) => (attrs.credit ? { "data-credit": attrs.credit } : {}),
      },
      rights: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-rights") ?? "",
        renderHTML: (attrs) => (attrs.rights ? { "data-rights": attrs.rights } : {}),
      },
    };
  },
});

/** Marks every image whose rights were unknown as allowed: the editor confirmed it when publishing. */
export function permitUnknownImagesIn(editor: Editor) {
  editor.commands.command(({ tr, state }) => {
    state.doc.descendants((node, pos) => {
      if (node.type.name === "image" && node.attrs.rights === "unknown") tr.setNodeMarkup(pos, undefined, { ...node.attrs, rights: "permitted" });
    });
    return true;
  });
}

/** Tables carry a caption (data-caption), shown as <caption> on the website: what the table is about. */
const CaptionedTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      caption: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-caption") ?? "",
        renderHTML: (attrs) => (attrs.caption ? { "data-caption": attrs.caption } : {}),
      },
    };
  },
});

export const CALLOUT_VARIANTS = ["info", "success", "warning"] as const;
export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

/** A highlighted box around one or more paragraphs: tip, key takeaway or warning. */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "paragraph+",
  defining: true,
  addAttributes() {
    return {
      variant: {
        default: "info",
        parseHTML: (el) => el.getAttribute("data-variant") ?? "info",
        renderHTML: (attrs) => ({ "data-variant": attrs.variant }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-callout": "" }), 0];
  },
});

/** Hands pasted or dropped image files to `onFiles` instead of letting the browser embed them. */
export const ImagePasteAndDrop = Extension.create<{
  onFiles: (editor: Editor, files: File[], at?: number) => void;
}>({
  name: "imagePasteAndDrop",
  addOptions() {
    return { onFiles: () => {} };
  },
  addProseMirrorPlugins() {
    const { editor, options } = this;
    return [
      new Plugin({
        key: new PluginKey("imagePasteAndDrop"),
        props: {
          handlePaste(_view, event) {
            const files = imageFiles(event.clipboardData?.files);
            if (files.length === 0) return false;
            event.preventDefault();
            options.onFiles(editor, files);
            return true;
          },
          handleDrop(view, event, _slice, moved) {
            const files = imageFiles(event.dataTransfer?.files);
            if (moved || files.length === 0) return false;
            event.preventDefault();
            options.onFiles(editor, files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
            return true;
          },
        },
      }),
    ];
  },
});

export type SlashState = {
  query: string;
  items: BlockItem[];
  rect: DOMRect | null;
  select: (item: BlockItem) => void;
};

type SlashStorage = { keyHandler: ((event: KeyboardEvent) => boolean) | null };

declare module "@tiptap/core" {
  interface Storage {
    slashCommand: SlashStorage;
  }
}

/** Lets the open "/" menu handle arrow keys and Enter; pass null when it closes. */
export function setSlashKeyHandler(editor: Editor, handler: SlashStorage["keyHandler"]) {
  editor.storage.slashCommand.keyHandler = handler;
}

/** Typing "/" opens a menu of blocks to insert, filtered by what follows the slash. */
export const SlashCommand = Extension.create<
  {
    onState: (state: SlashState | null) => void;
    onSelect: (item: BlockItem, editor: Editor) => void;
  },
  SlashStorage
>({
  name: "slashCommand",
  addOptions() {
    return { onState: () => {}, onSelect: () => {} };
  },
  addStorage() {
    return { keyHandler: null };
  },
  addProseMirrorPlugins() {
    const { options, storage } = this;
    return [
      Suggestion<BlockItem, BlockItem>({
        editor: this.editor,
        char: "/",
        // "/khung luu y" or "/warning box" should still match; the menu hides itself once nothing matches.
        allowSpaces: true,
        pluginKey: new PluginKey("slashCommand"),
        // Not inside code, where "/" is just a character.
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        items: ({ query }) => filterBlocks(query),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          options.onSelect(props, editor);
        },
        render: () => {
          const publish = (p: {
            query: string;
            items: BlockItem[];
            clientRect?: (() => DOMRect | null) | null;
            command: (item: BlockItem) => void;
          }) => options.onState({ query: p.query, items: p.items, rect: p.clientRect?.() ?? null, select: p.command });
          return {
            onStart: publish,
            onUpdate: publish,
            onExit: () => options.onState(null),
            onKeyDown: ({ event }) => storage.keyHandler?.(event) ?? false,
          };
        },
      }),
    ];
  },
});

/** Opens the link editor with Ctrl/Cmd + K. */
export const LinkShortcut = Extension.create<{ onOpen: () => void }>({
  name: "linkShortcut",
  addOptions() {
    return { onOpen: () => {} };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-k": () => {
        this.options.onOpen();
        return true;
      },
    };
  },
});

export function buildExtensions(handlers: {
  onFiles: (editor: Editor, files: File[], at?: number) => void;
  onSlashState: (state: SlashState | null) => void;
  onSlashSelect: (item: BlockItem, editor: Editor) => void;
  onOpenLink: () => void;
  /** Hints shown in empty blocks, in the interface language. */
  placeholders: { heading: string; paragraph: string };
}) {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      dropcursor: { color: "#16a260", width: 2 },
    }),
    CreditedImage.configure({ allowBase64: false }),
    Placeholder.configure({
      placeholder: ({ node }) =>
        node.type.name === "heading" ? handlers.placeholders.heading : handlers.placeholders.paragraph,
    }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Highlight.configure({ multicolor: true }),
    TextStyle,
    Color,
    TableKit.configure({ table: false }),
    CaptionedTable.configure({ resizable: false }),
    Youtube.configure({ nocookie: true, modestBranding: true, width: 640, height: 360 }),
    Callout,
    ImagePasteAndDrop.configure({ onFiles: handlers.onFiles }),
    SlashCommand.configure({
      onState: handlers.onSlashState,
      onSelect: handlers.onSlashSelect,
    }),
    LinkShortcut.configure({ onOpen: handlers.onOpenLink }),
  ];
}
