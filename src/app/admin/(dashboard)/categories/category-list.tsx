"use client";

import { useActionState, useState, useTransition } from "react";
import { ChevronDown, ChevronUp, CircleAlert, FolderTree, Pencil, Plus, Trash2, X } from "lucide-react";
import { ConfirmPopover } from "@/components/confirm-popover";
import { Field, FormMessage, SubmitButton, inputClass } from "@/components/form";
import type { Locale } from "@/db/schema";
import { fmt } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type { FormState } from "../users/actions";
import { deleteCategory, moveCategory, saveCategory } from "./actions";

export type CategoryRow = {
  id: string;
  nameVi: string;
  nameEn: string;
  slugVi: string;
  slugEn: string;
  descriptionVi: string;
  descriptionEn: string;
  posts: number;
};

type Site = { id: string; name: string; baseUrl: string; blogPaths: Record<Locale, string> };

/** One website's categories: order, edit, delete, and a form to add one; `tools` holds the AI buttons. */
export function CategoryList({ site, rows, tools }: { site: Site; rows: CategoryRow[]; tools: React.ReactNode }) {
  const { t: dict } = useI18n();
  const t = dict.categories;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();

  function run(action: () => Promise<FormState>) {
    setError(null);
    startBusy(async () => {
      const result = await action();
      if (result.error) setError(result.error);
    });
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4">
        <div>
          <h2 className="font-semibold">{site.name}</h2>
          <p className="text-xs text-zinc-500">{site.baseUrl.replace(/^https?:\/\//, "")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tools}
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-brand hover:border-brand-light"
          >
            {adding ? <X className="size-4" /> : <Plus className="size-4" />}
            {adding ? t.cancel : t.add}
          </button>
        </div>
      </div>

      {adding && (
        <div className="border-b border-zinc-200 bg-zinc-50/60 px-5 py-5">
          <p className="mb-4 text-sm font-semibold text-ink">{fmt(t.addTitle, { site: site.name })}</p>
          <CategoryForm siteId={site.id} onSaved={() => setAdding(false)} />
        </div>
      )}

      {error && (
        <p role="alert" className="mx-5 mt-4 flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-10 text-center text-sm text-zinc-500">
          <FolderTree className="size-6 text-zinc-300" />
          {t.empty}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                <th className="w-16 px-3 py-2.5" />
                <th className="px-3 py-2.5">{t.columns.name}</th>
                <th className="px-3 py-2.5">{t.columns.slug}</th>
                <th className="px-3 py-2.5 text-right">{t.columns.posts}</th>
                <th className="px-3 py-2.5 text-right">{t.columns.actions}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <CategoryTableRow
                  key={row.id}
                  row={row}
                  site={site}
                  first={i === 0}
                  last={i === rows.length - 1}
                  busy={busy}
                  editing={editing === row.id}
                  onEdit={() => setEditing(editing === row.id ? null : row.id)}
                  onSaved={() => setEditing(null)}
                  onMove={(direction) => run(() => moveCategory(row.id, direction))}
                  onDelete={() => run(() => deleteCategory(row.id))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CategoryTableRow({
  row,
  site,
  first,
  last,
  busy,
  editing,
  onEdit,
  onSaved,
  onMove,
  onDelete,
}: {
  row: CategoryRow;
  site: Site;
  first: boolean;
  last: boolean;
  busy: boolean;
  editing: boolean;
  onEdit: () => void;
  onSaved: () => void;
  onMove: (direction: "up" | "down") => void;
  onDelete: () => void;
}) {
  const { t: dict } = useI18n();
  const t = dict.categories;
  const iconButton = "rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <>
      <tr className={cn("border-b border-zinc-100 last:border-0", editing && "bg-brand-soft/40")}>
        <td className="px-3 py-3">
          <div className="flex flex-col">
            <button type="button" onClick={() => onMove("up")} disabled={first || busy} title={t.moveUp} aria-label={t.moveUp} className={iconButton}>
              <ChevronUp className="size-3.5" />
            </button>
            <button type="button" onClick={() => onMove("down")} disabled={last || busy} title={t.moveDown} aria-label={t.moveDown} className={iconButton}>
              <ChevronDown className="size-3.5" />
            </button>
          </div>
        </td>
        <td className="px-3 py-3">
          <p className="font-medium text-ink">{row.nameVi}</p>
          <p className="text-xs text-zinc-500">{row.nameEn}</p>
        </td>
        <td className="px-3 py-3 font-mono text-xs text-zinc-500">
          <p>
            {site.blogPaths.vi}/category/{row.slugVi}
          </p>
          <p>
            {site.blogPaths.en}/category/{row.slugEn}
          </p>
        </td>
        <td className="px-3 py-3 text-right text-zinc-600">{fmt(t.postsCount, { n: row.posts })}</td>
        <td className="px-3 py-3">
          <div className="flex justify-end gap-0.5">
            <button type="button" onClick={onEdit} title={t.edit} aria-label={t.edit} className={iconButton}>
              <Pencil className="size-4" />
            </button>
            <ConfirmPopover
              message={fmt(t.confirmDelete, { name: row.nameVi })}
              hint={t.confirmDeleteHint}
              confirmLabel={t.delete}
              onConfirm={onDelete}
            >
              {(open) => (
                <button
                  type="button"
                  onClick={open}
                  disabled={busy}
                  title={t.delete}
                  aria-label={t.delete}
                  className="rounded-md p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </ConfirmPopover>
          </div>
        </td>
      </tr>
      {editing && (
        <tr className="border-b border-zinc-100 bg-brand-soft/40">
          <td colSpan={5} className="px-5 pb-5 pt-1">
            <CategoryForm siteId={site.id} row={row} onSaved={onSaved} />
          </td>
        </tr>
      )}
    </>
  );
}

function CategoryForm({ siteId, row, onSaved }: { siteId: string; row?: CategoryRow; onSaved: () => void }) {
  const { t: dict } = useI18n();
  const t = dict.categories;
  const [state, action] = useActionState(async (prev: FormState, formData: FormData) => {
    const result = await saveCategory(prev, formData);
    if (result.success) onSaved();
    return result;
  }, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="siteId" value={siteId} />
      {row && <input type="hidden" name="id" value={row.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.nameVi}>
          <input name="nameVi" required maxLength={80} defaultValue={row?.nameVi} className={inputClass} />
        </Field>
        <Field label={t.nameEn}>
          <input name="nameEn" required maxLength={80} defaultValue={row?.nameEn} className={inputClass} />
        </Field>
        <Field label={t.slugVi} hint={row ? t.slugHint : undefined}>
          <input name="slugVi" maxLength={80} defaultValue={row?.slugVi} className={cn(inputClass, "font-mono")} />
        </Field>
        <Field label={t.slugEn}>
          <input name="slugEn" maxLength={80} defaultValue={row?.slugEn} className={cn(inputClass, "font-mono")} />
        </Field>
        <Field label={t.descriptionVi} hint={t.descriptionHint}>
          <textarea name="descriptionVi" rows={2} maxLength={400} defaultValue={row?.descriptionVi} className={cn(inputClass, "resize-y")} />
        </Field>
        <Field label={t.descriptionEn}>
          <textarea name="descriptionEn" rows={2} maxLength={400} defaultValue={row?.descriptionEn} className={cn(inputClass, "resize-y")} />
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton>{row ? t.save : t.create}</SubmitButton>
    </form>
  );
}
