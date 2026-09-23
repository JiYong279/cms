/** Fills {placeholders}: fmt("Đã chọn {n} bài", { n: 3 }) → "Đã chọn 3 bài". */
export function fmt(template: string, vars: Record<string, string | number> = {}) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

/** Picks the singular or plural template (English needs both; Vietnamese uses the same). */
export function plural(n: number, one: string, other: string, vars: Record<string, string | number> = {}) {
  return fmt(n === 1 ? one : other, { n, ...vars });
}
