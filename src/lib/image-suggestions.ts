import type { JSONContent } from "@tiptap/react";

/**
 * A spot where the AI suggests an image: what it should show, with the description (alt) and caption
 * ready for the real one. Written as <div data-image-suggestion data-alt="…" data-caption="…">what</div>
 * (Tiptap node "imageSuggestion"). Suggestions are for the team only: they never reach a website.
 */

const SUGGESTION = /<div\b[^>]*\bdata-image-suggestion\b[^>]*>[\s\S]*?<\/div>/g;

export function countImageSuggestions(html: string) {
  return html.match(SUGGESTION)?.length ?? 0;
}

export function stripImageSuggestions(html: string) {
  return html.replace(SUGGESTION, "");
}

export function stripImageSuggestionsFromDoc(doc: JSONContent): JSONContent {
  if (!doc.content) return doc;
  return { ...doc, content: doc.content.filter((c) => c.type !== "imageSuggestion").map(stripImageSuggestionsFromDoc) };
}

const escape = (text: string) => text.replace(/&(?!(?:[a-z]+|#\d+);)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The HTML of a suggestion; the three parts may already be HTML-escaped (Markdown output). */
export function imageSuggestionHtml(parts: { description: string; alt: string; caption: string }) {
  return `<div data-image-suggestion="" data-alt="${escape(parts.alt.trim())}" data-caption="${escape(parts.caption.trim())}">${escape(parts.description.trim())}</div>`;
}
