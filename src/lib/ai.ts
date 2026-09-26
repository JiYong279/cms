import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Locale } from "@/db/schema";
import { siteBrief } from "./ai-brief";
import { seoFixPrompt, type AiField, type FixArticle } from "./seo-fix";

/**
 * The editor's AI assistant: drafts an article from a topic, or translates one into the other
 * language. Needs ANTHROPIC_API_KEY; AI_MODEL picks the Claude model. The result is only ever
 * put into the editor: people review it and save or publish as usual.
 */

const MODEL = process.env.AI_MODEL || "claude-sonnet-5";
const MAX_TOKENS = 16_000;

export function aiConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

const LANGUAGE: Record<Locale, string> = { vi: "Vietnamese", en: "English" };

export type ArticleFields = {
  title: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  focusKeyword: string;
  /** Article body as HTML the editor understands (see BODY_HTML_RULES). */
  html: string;
  /** Drafts only: the name of the existing category that fits best. */
  category?: string;
};

const ArticleSchema = z.object({
  title: z.string().trim().min(1).max(200),
  excerpt: z.string().trim().max(500),
  metaTitle: z.string().trim().max(200),
  metaDescription: z.string().trim().max(500),
  focusKeyword: z.string().trim().max(100),
  html: z.string().trim().min(1),
  category: z.string().trim().optional(),
});

/**
 * The model answers through this tool, so the reply is always the fields the editor needs.
 * With `categories`, it also picks one of them.
 */
function articleTool(categories: string[] = []): Anthropic.Tool {
  return {
    name: "article",
    description: "Returns the finished article.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Headline, at most about 90 characters." },
        excerpt: { type: "string", description: "One or two sentence summary shown under the title and in article lists." },
        metaTitle: { type: "string", description: "Title for search engines, under 60 characters." },
        metaDescription: { type: "string", description: "Description for search engines, 120 to 155 characters." },
        focusKeyword: { type: "string", description: "The main search phrase the article targets." },
        html: { type: "string", description: "The article body, following the HTML rules." },
        ...(categories.length
          ? { category: { type: "string", enum: categories, description: "The existing category that fits the article best." } }
          : {}),
      },
      required: ["title", "excerpt", "metaTitle", "metaDescription", "focusKeyword", "html", ...(categories.length ? ["category"] : [])],
    },
  };
}
  
const BODY_HTML_RULES = `HTML rules for the article body:
- Use only: <h2>, <h3>, <p>, <strong>, <em>, <a href="…">, <ul>, <ol>, <li>, <blockquote>, <hr>,
  <table> with <tr>, <th>, <td>, and callouts written as <div data-callout data-variant="info|success|warning"><p>…</p></div>.
- Every section starts with an <h2>; the website builds the table of contents from them. Do not repeat the title as a heading.
- Put <p> inside every <li>, <th>, <td> and callout.
- No classes, inline styles, images, scripts or Markdown.`;

export type SiteContext = {
  name: string;
  baseUrl: string;
  glossary: { vi: string; en: string; note: string }[];
  /** Category names in the language being written, for drafts. */
  categories: string[];
};

function glossaryText(site: SiteContext) {
  if (site.glossary.length === 0) return "";
  const rows = site.glossary.map((g) => `- ${g.vi} = ${g.en}${g.note ? ` (${g.note})` : ""}`).join("\n");
  return `\nAlways use these agreed translations (Vietnamese = English):\n${rows}\n`;
}

async function callArticleTool(system: string, prompt: string, categories?: string[]): Promise<ArticleFields> {
  const tool = articleTool(categories);
  const client = new Anthropic();
  // Streaming keeps the connection alive while a long article is being written.
  const message = await client.messages
    .stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: prompt }],
    })
    .finalMessage();

  if (message.stop_reason === "max_tokens") throw new AiError("too_long");
  const block = message.content.find((b) => b.type === "tool_use");
  const parsed = ArticleSchema.safeParse(block?.type === "tool_use" ? block.input : null);
  if (!parsed.success) throw new AiError("bad_answer");
  return parsed.data;
}

/** A failure worth telling the user about in their own words; other errors are unexpected. */
export class AiError extends Error {
  constructor(public code: "not_configured" | "too_long" | "bad_answer" | "unavailable" | "rejected") {
    super(code);
  }
}

/** Anthropic API errors, as the codes the editor explains. */
function explain(error: unknown): never {
  if (error instanceof AiError) throw error;
  if (error instanceof Anthropic.APIError) {
    console.error(`[ai] Anthropic API ${error.status}:`, error.message);
    throw new AiError(error.status === 400 ? "rejected" : "unavailable");
  }
  throw error;
}

export const DRAFT_LENGTHS = { short: 600, medium: 1200, long: 2000 } as const;
export type DraftLength = keyof typeof DRAFT_LENGTHS;

export async function draftArticle(input: {
  siteId: string;
  site: SiteContext;
  locale: Locale;
  topic: string;
  keyPoints: string;
  focusKeyword: string;
  length: DraftLength;
}): Promise<ArticleFields> {
  if (!aiConfigured()) throw new AiError("not_configured");
  const system = `You write blog articles for a company website.
${siteBrief(input.siteId, input.site)}
Write in ${LANGUAGE[input.locale]}, in a clear, warm and professional voice. Prefer concrete examples,
short paragraphs and lists over generic statements. Do not invent statistics, prices, laws or
regulations; when a point depends on a regulation, say readers should check the current text.
${glossaryText(input.site)}
${BODY_HTML_RULES}`;
  const prompt = [
    `Write an article of about ${DRAFT_LENGTHS[input.length]} words.`,
    `Topic: ${input.topic}`,
    input.keyPoints && `Points to cover:\n${input.keyPoints}`,
    input.focusKeyword && `Main search phrase: ${input.focusKeyword}`,
    "End with a short conclusion, for example in a success callout.",
  ]
    .filter(Boolean)
    .join("\n\n");
  try {
    return await callArticleTool(system, prompt, input.site.categories);
  } catch (error) {
    explain(error);
  }
}

export async function translateArticle(input: {
  siteId: string;
  site: SiteContext;
  from: Locale;
  to: Locale;
  source: ArticleFields;
}): Promise<ArticleFields> {
  if (!aiConfigured()) throw new AiError("not_configured");
  const system = `You translate blog articles from ${LANGUAGE[input.from]} into ${LANGUAGE[input.to]} for a company website.
${siteBrief(input.siteId, input.site)}
Translate faithfully and naturally, as a native ${LANGUAGE[input.to]} writer would put it; keep the meaning,
tone and structure. Keep every HTML tag and attribute exactly as it is (links, images, videos, callouts,
tables); translate only the text and image alt attributes. Adapt the search fields (meta title,
meta description, main search phrase) to what ${LANGUAGE[input.to]} readers would search for.
${glossaryText(input.site)}`;
  const { source } = input;
  const prompt = `Translate this article.

Title: ${source.title}
Summary: ${source.excerpt}
Meta title: ${source.metaTitle}
Meta description: ${source.metaDescription}
Main search phrase: ${source.focusKeyword}

Body HTML:
${source.html}`;
  try {
    return await callArticleTool(system, prompt);
  } catch (error) {
    explain(error);
  }
}

/**
 * Rewrites some SEO fields of an article ("Fix with AI" in the SEO score). Answers through a tool
 * holding only those fields; lengths are checked by the editor, which shows the answer for review.
 */
export async function fixSeoFields(input: {
  siteId: string;
  site: SiteContext;
  locale: Locale;
  fields: AiField[];
  article: FixArticle;
}): Promise<Partial<Record<AiField, string>>> {
  if (!aiConfigured()) throw new AiError("not_configured");
  const tool: Anthropic.Tool = {
    name: "seo_fields",
    description: "Returns the rewritten SEO fields.",
    input_schema: {
      type: "object",
      properties: Object.fromEntries(input.fields.map((f) => [f, { type: "string" }])),
      required: [...input.fields],
    },
  };
  const prompt = seoFixPrompt({ site: { id: input.siteId, ...input.site }, locale: input.locale, fields: input.fields, article: input.article, answer: "tool" });
  try {
    const message = await new Anthropic().messages.create({
      model: MODEL,
      max_tokens: 1_000,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: prompt }],
    });
    const block = message.content.find((b) => b.type === "tool_use");
    const parsed = z
      .object(Object.fromEntries(input.fields.map((f) => [f, z.string().trim().min(1).max(500)])))
      .safeParse(block?.type === "tool_use" ? block.input : null);
    if (!parsed.success) throw new AiError("bad_answer");
    return parsed.data as Partial<Record<AiField, string>>;
  } catch (error) {
    explain(error);
  }
}
