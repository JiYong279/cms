import type { Locale } from "@/db/schema";

/**
 * How an AI-written article credits what it takes from elsewhere: every outside fact links to where
 * it comes from, official sources first, and no link is ever made up. Readers (and search engines)
 * trust a health or legal claim they can check.
 */
export const SOURCE_RULES: Record<Locale, string> = {
  vi: `Dẫn nguồn (bắt buộc):
- Mỗi số liệu, quy định, trích dẫn hay thông tin lấy từ bên ngoài phải có link tới nơi gốc ngay trong câu, dạng [tên nguồn](đường dẫn).
- Ưu tiên nguồn chính thống: cơ quan nhà nước Việt Nam (chinhphu.vn, vbpl.vn, moh.gov.vn và các trang .gov.vn), Tổ chức Y tế Thế giới (who.int), bệnh viện và trường đại học (.edu, .edu.vn), nghiên cứu khoa học (pubmed.ncbi.nlm.nih.gov). Chỉ dùng báo lớn khi không có nguồn chính thống; không lấy blog, diễn đàn hay trang bán hàng làm nguồn.
- Văn bản pháp luật: ghi đúng số hiệu, ngày ban hành, cơ quan ban hành, và link tới văn bản gốc.
- Tìm trên web để lấy đường dẫn thật. Chỉ dùng link bạn chắc chắn tồn tại; không chắc thì bỏ thông tin đó, tuyệt đối không bịa link.
- Cuối bài thêm mục "## Nguồn tham khảo" liệt kê các nguồn đã dùng, mỗi dòng một link.`,
  en: `Sources (required):
- Every figure, regulation, quotation or other outside fact links to where it comes from, in the same sentence, as [source name](address).
- Official sources first: government bodies (in Vietnam chinhphu.vn, vbpl.vn, moh.gov.vn and other .gov.vn sites; elsewhere .gov), the World Health Organization (who.int), hospitals and universities (.edu), research (pubmed.ncbi.nlm.nih.gov). Use major newspapers only when there is no official source; never blogs, forums or sales pages.
- Laws and regulations: give the exact number, date and issuing body, linking to the original text.
- Search the web for the real addresses. Use only links you are sure exist; if unsure, leave the fact out. Never make up a link.
- End with a "## Sources" section listing the sources used, one link per line.`,
};

/**
 * The built-in AI cannot browse: the same rules, but it may only link pages it is certain of.
 * (Written for the API's system prompt, which is always in English.)
 */
export const SOURCE_RULES_NO_BROWSING = `Sources (required):
- Every figure, regulation, quotation or other outside fact links to where it comes from, in the same sentence, with <a href="…">source name</a>.
- Official sources first: government bodies (in Vietnam chinhphu.vn, vbpl.vn, moh.gov.vn and other .gov.vn sites), the World Health Organization (who.int), hospitals and universities, research on pubmed.ncbi.nlm.nih.gov. Never blogs, forums or sales pages.
- Laws and regulations: give the exact number, date and issuing body.
- You cannot browse, so link only pages you are certain exist (such as an official body's home page); if unsure of the address, leave the fact out rather than invent a link.
- End with a section titled "Sources" in the article's language (Vietnamese: "Nguồn tham khảo") listing the sources used.`;
