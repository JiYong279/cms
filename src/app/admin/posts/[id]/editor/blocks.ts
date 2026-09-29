import type { Editor } from "@tiptap/react";
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Heading2,
  Heading3,
  ImagePlus,
  Info,
  Link2,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Table,
  SquarePlay,
  type LucideIcon, ImageIcon } from "lucide-react";
import { dictionaries, type Dict } from "@/i18n";
import { slugify } from "@/lib/posts";

/** Actions that need the editor's surrounding UI (file picker, dialogs). */
export type EditorUi = {
  pickImage: () => void;
  /** Free stock photos (Pexels), inserted at the cursor. */
  pickStock: (editor: Editor) => void;
  promptImageUrl: (editor: Editor) => void;
  promptYoutube: (editor: Editor) => void;
};

/** Labels and descriptions live in the dictionary under `editor.blocks[id]`. */
export type BlockId = keyof Dict["editor"]["blocks"];
export type BlockGroup = keyof Dict["editor"]["groups"];

export type BlockItem = {
  id: BlockId;
  /** Extra search words for the "/" menu, besides the label in both languages (no accents). */
  keywords: string;
  icon: LucideIcon;
  group: BlockGroup;
  run: (editor: Editor, ui: EditorUi) => void;
};

/** Everything that can be inserted from the "Insert" menu or by typing "/". */
export const BLOCKS: BlockItem[] = [
  {
    id: "paragraph",
    keywords: "paragraph text plain doan van chu thuong",
    icon: Pilcrow,
    group: "text",
    run: (e) => e.chain().focus().setParagraph().run(),
  },
  {
    id: "h2",
    keywords: "heading h2 title section tieu de muc",
    icon: Heading2,
    group: "text",
    run: (e) => e.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    id: "h3",
    keywords: "heading h3 subheading subtitle tieu de nho",
    icon: Heading3,
    group: "text",
    run: (e) => e.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    id: "bullet",
    keywords: "bullet bulleted unordered list danh sach cham",
    icon: List,
    group: "text",
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: "ordered",
    keywords: "ordered numbered list steps danh sach so buoc",
    icon: ListOrdered,
    group: "text",
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "quote",
    keywords: "quote quotation blockquote trich dan",
    icon: Quote,
    group: "text",
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "image",
    keywords: "image photo picture upload computer anh hinh may",
    icon: ImagePlus,
    group: "media",
    run: (_e, ui) => ui.pickImage(),
  },
  {
    id: "stock-image",
    keywords: "stock photo free pexels anh mien phi kho",
    icon: ImageIcon,
    group: "media",
    run: (e, ui) => ui.pickStock(e),
  },
  {
    id: "image-url",
    keywords: "image photo url link web anh duong dan",
    icon: Link2,
    group: "media",
    run: (e, ui) => ui.promptImageUrl(e),
  },
  {
    id: "youtube",
    keywords: "youtube video embed nhung",
    icon: SquarePlay,
    group: "media",
    run: (e, ui) => ui.promptYoutube(e),
  },
  {
    id: "table",
    keywords: "table grid compare comparison bang so sanh",
    icon: Table,
    group: "blocks",
    run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: "callout-info",
    keywords: "callout box info note tip khung ghi chu thong tin meo",
    icon: Info,
    group: "blocks",
    run: (e) => e.chain().focus().wrapIn("callout", { variant: "info" }).run(),
  },
  {
    id: "callout-success",
    keywords: "callout box success key takeaway summary khung diem chinh tom tat",
    icon: CheckCircle2,
    group: "blocks",
    run: (e) => e.chain().focus().wrapIn("callout", { variant: "success" }).run(),
  },
  {
    id: "callout-warning",
    keywords: "callout box warning caution alert canh bao luu y",
    icon: AlertTriangle,
    group: "blocks",
    run: (e) => e.chain().focus().wrapIn("callout", { variant: "warning" }).run(),
  },
  {
    id: "code",
    keywords: "code block snippet command ma lenh",
    icon: Code2,
    group: "blocks",
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "divider",
    keywords: "divider separator horizontal rule line hr duong phan cach",
    icon: Minus,
    group: "blocks",
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
];

const words = (text: string) => slugify(text).replace(/-/g, " ");

/** What "/" searches for each block: its label in every interface language plus its keywords. */
const SEARCH_TEXT = new Map(
  BLOCKS.map((b) => [
    b.id,
    `${words(dictionaries.vi.editor.blocks[b.id].label)} ${words(dictionaries.en.editor.blocks[b.id].label)} ${b.keywords}`,
  ]),
);

/** Blocks matching what was typed after "/", ignoring accents ("bang" finds "Bảng", "table" too). */
export function filterBlocks(query: string) {
  const q = words(query);
  if (!q) return BLOCKS;
  return BLOCKS.filter((b) => SEARCH_TEXT.get(b.id)?.includes(q));
}
