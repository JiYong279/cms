// What the activity log records about a save, and the detail lines it shows for it.
//   npx tsx tests/seo/activity-details.test.ts
import { dictionaries } from "../../src/i18n";
import { getFieldChanges, mergeFieldChanges, MAX_VALUE_CHARS } from "../../src/lib/activity-changes";
import { describeActivityDetails } from "../../src/lib/activity-text";
import { getVersionChanges, type VersionSnapshot } from "../../src/app/admin/posts/version-changes";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `  -> ${detail}` : ""}`);
};
const vi = dictionaries.vi;
const lines = (meta: Record<string, unknown>) => describeActivityDetails({ meta }, vi, "Asia/Ho_Chi_Minh");

// Field changes
const changes = getFieldChanges({ title: "A", excerpt: "", noindex: false }, { title: "B", excerpt: null, noindex: true });
check("only changed fields are kept; empty text and no value are the same", JSON.stringify(changes) === JSON.stringify([
  { field: "title", from: "A", to: "B" },
  { field: "noindex", from: false, to: true },
]), JSON.stringify(changes));
const long = getFieldChanges({ metaDescription: "" }, { metaDescription: "x".repeat(400) });
check("long values are cut", String(long[0].to).length === MAX_VALUE_CHARS && String(long[0].to).endsWith("…"));

// Several saves in one editing session become one entry
const merged = mergeFieldChanges(
  [{ field: "title", from: "A", to: "B" }, { field: "slug", from: "a", to: "b" }],
  [{ field: "title", from: "B", to: "C" }, { field: "slug", from: "b", to: "a" }, { field: "excerpt", from: null, to: "Tóm tắt" }],
);
check("merged: first value before, last value after", JSON.stringify(merged.find((c) => c.field === "title")) === JSON.stringify({ field: "title", from: "A", to: "C" }));
check("merged: a field changed back is dropped", !merged.some((c) => c.field === "slug"));
check("merged: fields of the later save are added", merged.some((c) => c.field === "excerpt"));

// An article version
const base: VersionSnapshot = {
  title: "Quản lý spa", excerpt: "", contentHtml: "<p>một hai ba</p>", metaTitle: "", metaDescription: "", focusKeyword: "spa",
  slug: "quan-ly-spa", scheduledAt: null, publishedAt: null, noindex: false, coverImageAlt: "", category: "Vận hành",
  featured: false, pillar: false, coverImageUrl: null,
};
const after = { ...base, title: "Quản lý spa 2026", contentHtml: "<p>một hai ba bốn năm</p>", category: "Báo cáo", coverImageUrl: "https://x/y.png", scheduledAt: new Date("2026-10-09T01:00:00Z") };
const version = getVersionChanges(base, after);
check("the body is recorded as word counts, right after the title", JSON.stringify(version.slice(0, 2)) === JSON.stringify([
  { field: "title", from: "Quản lý spa", to: "Quản lý spa 2026" },
  { field: "content", from: 3, to: 5 },
]), JSON.stringify(version));
check("category, cover and schedule are recorded", ["category", "coverImageUrl", "scheduledAt"].every((f) => version.some((c) => c.field === f)));
check("a first version only records its length", JSON.stringify(getVersionChanges(null, base)) === JSON.stringify([{ field: "content", from: null, to: 3 }]));
check("nothing changed, nothing recorded", getVersionChanges(base, { ...base }).length === 0);

// The lines shown
const shown = lines({ fields: version });
check("title line", shown.includes("Tiêu đề: “Quản lý spa” → “Quản lý spa 2026”"), shown.join(" | "));
check("body line with the difference", shown.includes("Nội dung: 3 → 5 chữ (+2)"), shown.join(" | "));
check("category line", shown.includes("Danh mục: “Vận hành” → “Báo cáo”"), shown.join(" | "));
check("cover line without the address", shown.includes("Ảnh bìa: thêm ảnh"), shown.join(" | "));
check("schedule in the reader's time zone", shown.some((l) => l.startsWith("Giờ hẹn đăng:") && l.includes("08:00")), shown.join(" | "));
check("same length, other words", lines({ fields: [{ field: "content", from: 5, to: 5 }] })[0] === "Nội dung: sửa câu chữ, vẫn 5 chữ");
check("switches say on/off", lines({ fields: [{ field: "noindex", from: false, to: true }] })[0] === "Ẩn khỏi Google: bật");
check("older entries: the renamed address", lines({ slugFrom: "a", slugTo: "b" })[0] === "Đường dẫn: “a” → “b”");
check("sign-ins: the IP address", lines({ ip: "203.0.113.5" })[0] === "Địa chỉ IP: 203.0.113.5");
check("in English too", describeActivityDetails({ meta: { fields: [{ field: "content", from: 10, to: 4 }] } }, dictionaries.en, "UTC")[0] === "Body: 10 → 4 words (−6)");
check("no meta, no lines", describeActivityDetails({ meta: null }, vi, "UTC").length === 0);

console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
process.exit(failures ? 1 : 0);
