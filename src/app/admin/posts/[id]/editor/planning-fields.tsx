"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { planPost, type PlanInput } from "../../planning-actions";
import { Field, inputClass } from "./panel";

type Props = {
  postId: string;
  plannedFor: string | null;
  assigneeId: string | null;
  /** Editors and admins who can look after the article (the current one included). */
  assignees: { id: string; name: string }[];
  canAssign: boolean;
};

/**
 * The article's planned day and who looks after it. Saved as soon as they change, apart from the
 * article's own Save: they place it on the editorial calendar and are never shown on the website.
 */
export function PlanningFields({ postId, plannedFor: initialDay, assigneeId: initialAssignee, assignees, canAssign }: Props) {
  const { t } = useI18n();
  const p = t.editor.panel;
  const [day, setDay] = useState(initialDay ?? "");
  const [assigneeId, setAssigneeId] = useState(initialAssignee ?? "");
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function save(change: Omit<PlanInput, "postId">, undo: () => void) {
    setState(null);
    start(async () => {
      const result = await planPost({ postId, ...change });
      if (result.ok) {
        setState({ ok: true, text: p.planningSaved });
      } else {
        undo();
        setState({ ok: false, text: result.error });
      }
    });
  }

  const assigneeName = assignees.find((a) => a.id === assigneeId)?.name;

  return (
    <>
      <Field label={p.plannedFor}>
        <input
          id="field-planned-for"
          type="date"
          value={day}
          onChange={(e) => {
            const before = day;
            setDay(e.target.value);
            save({ plannedFor: e.target.value || null }, () => setDay(before));
          }}
          className={inputClass}
        />
      </Field>
      <Field label={p.assignee}>
        {canAssign ? (
          <select
            id="field-assignee"
            value={assigneeId}
            onChange={(e) => {
              const before = assigneeId;
              setAssigneeId(e.target.value);
              save({ assigneeId: e.target.value || null }, () => setAssigneeId(before));
            }}
            className={inputClass}
          >
            <option value="">{p.noAssignee}</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        ) : (
          <span id="field-assignee" className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-normal text-zinc-600">
            {assigneeName ?? p.noAssignee}
          </span>
        )}
      </Field>
      <p className="text-xs text-zinc-500">{p.assigneeHint}</p>
      <p aria-live="polite" className="flex min-h-4 items-center gap-1.5 text-xs">
        {pending ? (
          <Loader2 className="size-3.5 animate-spin text-zinc-400" />
        ) : state ? (
          <span className={state.ok ? "flex items-center gap-1 text-emerald-700" : "text-red-600"}>
            {state.ok && <Check className="size-3.5" />}
            {state.text}
          </span>
        ) : null}
      </p>
    </>
  );
}
