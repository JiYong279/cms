"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

export type AiEngine = "own" | "builtin";

type Props = {
  engine: AiEngine;
  onEngine: (engine: AiEngine) => void;
  aiEnabled: boolean;
  /** Builds the prompt to copy, or returns null when the form is not ready (it shows its own error). */
  buildPrompt: () => string | null;
  pasted: string;
  onPaste: (value: string) => void;
  pastePlaceholder: string;
};

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-bright focus:ring-2 focus:ring-brand-bright/20";

/**
 * "Your Claude" or the built-in AI: the switch, and for "Your Claude" the copy-prompt and paste-answer
 * steps. The dialog around it runs the built-in AI and reads the pasted answer.
 */
export function AiEnginePanel({ engine, onEngine, aiEnabled, buildPrompt, pasted, onPaste, pastePlaceholder }: Props) {
  const { t } = useI18n();
  const a = t.editor.ai;
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState<"yes" | "manual" | null>(null);

  function copyPrompt() {
    const text = buildPrompt();
    if (!text) return;
    setPrompt(text);
    navigator.clipboard.writeText(text).then(
      () => setCopied("yes"),
      // No clipboard access (e.g. a plain-http address): the prompt is shown to copy by hand.
      () => setCopied("manual"),
    );
  }

  return (
    <>
      <div className="mt-2 flex rounded-lg bg-zinc-100 p-1" role="radiogroup" aria-label={a.engine}>
        {(["own", "builtin"] as const).map((e) => (
          <button
            key={e}
            type="button"
            role="radio"
            aria-checked={engine === e}
            onClick={() => onEngine(e)}
            className={cn("flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition", engine === e ? "bg-white text-ink shadow-sm" : "text-zinc-500 hover:text-zinc-800")}
          >
            {e === "own" ? a.engineOwn : a.engineBuiltin}
          </button>
        ))}
      </div>
      <p className="text-xs text-zinc-500">{engine === "own" ? a.engineOwnHint : aiEnabled ? a.engineBuiltinHint : a.errors.not_configured}</p>

      {engine === "own" && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={copyPrompt}
              className="inline-flex items-center gap-2 rounded-lg border border-brand px-3.5 py-2 text-sm font-semibold text-brand hover:bg-brand-soft"
            >
              <Copy className="size-4" />
              {a.copyPrompt}
            </button>
            <a href="https://claude.ai/new" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:text-brand-hover">
              {t.posts.plan.openClaude}
              <ExternalLink className="size-3.5" />
            </a>
            {copied === "yes" && (
              <span role="status" className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                <Check className="size-3.5" />
                {a.copied}
              </span>
            )}
          </div>
          {prompt && (
            <details open={copied === "manual"} className="rounded-lg border border-zinc-200 bg-zinc-50 text-xs">
              <summary className="cursor-pointer px-3 py-2 font-medium text-zinc-600">{copied === "manual" ? a.copyFailed : a.showPrompt}</summary>
              <textarea
                readOnly
                value={prompt}
                rows={6}
                aria-label={a.showPrompt}
                onFocus={(e) => e.currentTarget.select()}
                className="block w-full resize-y border-t border-zinc-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-zinc-700 outline-none"
              />
            </details>
          )}
          <textarea
            rows={4}
            value={pasted}
            onChange={(e) => onPaste(e.target.value)}
            placeholder={pastePlaceholder}
            aria-label={a.step2}
            className={cn(inputClass, "resize-y font-mono text-xs")}
          />
          <p className="-mt-1 text-xs text-zinc-500">{a.step2Hint}</p>
        </>
      )}
    </>
  );
}
