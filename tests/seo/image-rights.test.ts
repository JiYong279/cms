// Image rights and credits: counting unknown ones, confirming them, keeping them through a translation.
//   npx tsx tests/seo/image-rights.test.ts
import { carryImageCredits, countUnknownImages, permitUnknownImages, permitUnknownImagesInHtml } from "../../src/lib/image-rights";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `  -> ${detail}` : ""}`);
};

const html = [
  '<p>Mở đầu.</p>',
  '<img src="https://cdn/a.webp" alt="A" data-rights="unknown">',
  '<img src="https://cdn/b.webp" alt="B" data-rights="own" data-credit="Qub-X">',
  '<img data-rights="unknown" src="https://cdn/c.webp" alt="C">',
  '<img src="https://cdn/d.webp" alt="D">',
].join("");
check("unknown images are counted, whatever the attribute order", countUnknownImages(html) === 2, String(countUnknownImages(html)));
check("an article without them counts none", countUnknownImages("<p>Chữ.</p>") === 0);
const permitted = permitUnknownImagesInHtml(html);
check("confirming turns every unknown image into allowed, and nothing else", countUnknownImages(permitted) === 0 && (permitted.match(/data-rights="permitted"/g) ?? []).length === 2 && permitted.includes('data-rights="own"'));

const doc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Mở đầu." }] },
    { type: "image", attrs: { src: "https://cdn/a.webp", rights: "unknown" } },
    { type: "image", attrs: { src: "https://cdn/b.webp", rights: "own" } },
  ],
};
const json = permitUnknownImages(doc);
check("the document gets the same confirmation", json?.content?.[1]?.attrs?.rights === "permitted" && json?.content?.[2]?.attrs?.rights === "own" && json?.content?.[0]?.content?.[0]?.text === "Mở đầu.");
check("the original document is left untouched", doc.content[1].attrs?.rights === "unknown");

const translated = '<p>Intro.</p><img src="https://cdn/b.webp" alt="B in English"><img src="https://cdn/z.webp" alt="New">';
const carried = carryImageCredits(translated, html);
check(
  "a pasted translation gets back each image's rights and credit from the source",
  carried.includes('data-rights="own" data-credit="Qub-X" src="https://cdn/b.webp" alt="B in English"') || /<img data-rights="own" data-credit="Qub-X" src="https:\/\/cdn\/b\.webp"/.test(carried),
  carried,
);
check("an image not in the source is left as it is", carried.includes('<img src="https://cdn/z.webp" alt="New">'));

console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
process.exit(failures ? 1 : 0);
