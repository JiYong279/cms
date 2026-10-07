/**
 * What a save changed, kept with its activity-log entry (`meta.fields`), so the log can say more
 * than "edited": which fields, from what to what. Only short values are kept; long texts are
 * cut, and an article's body is recorded as its word count.
 */
export type FieldValue = string | number | boolean | null;
export type FieldChange = { field: string; from: FieldValue; to: FieldValue };

/** Longest text kept for one value. */
export const MAX_VALUE_CHARS = 160;

function clip(value: FieldValue): FieldValue {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_VALUE_CHARS ? `${trimmed.slice(0, MAX_VALUE_CHARS - 1)}…` : trimmed;
}

const isSame = (a: FieldValue, b: FieldValue) => (a ?? "") === (b ?? "");

/** One change for each field whose value differs; an empty text and no value are the same. */
export function getFieldChanges(before: Record<string, FieldValue>, after: Record<string, FieldValue>): FieldChange[] {
  return Object.keys(after)
    .filter((field) => !isSame(before[field] ?? null, after[field]))
    .map((field) => ({ field, from: clip(before[field] ?? null), to: clip(after[field]) }));
}

/** Two saves in a row become one change per field: the value before the first, the value after the last. */
export function mergeFieldChanges(earlier: FieldChange[], later: FieldChange[]): FieldChange[] {
  const merged = new Map(earlier.map((c) => [c.field, c]));
  for (const c of later) {
    const first = merged.get(c.field);
    merged.set(c.field, first ? { field: c.field, from: first.from, to: c.to } : c);
  }
  // A field changed and then changed back is no change, except the body: same length, other words.
  return [...merged.values()].filter((c) => c.field === "content" || !isSame(c.from, c.to));
}

export function isFieldChangeList(value: unknown): value is FieldChange[] {
  return Array.isArray(value) && value.every((c) => !!c && typeof c === "object" && typeof (c as FieldChange).field === "string");
}
