@AGENTS.md

## Git
- Nhánh <type>/<kebab-mô-tả> tách từ dev; PR vào dev; dev → main bằng PR (main tự deploy staging).
- Không push thẳng dev/main.
- Commit: <type>(<scope>)?: <mệnh lệnh, chữ thường>, subject ≤ 72 ký tự, body ≤ 3 dòng nói cái gì + vì sao.
  type: feat | fix | refactor | chore | docs | test.
- Commit message viết tiếng Anh.
- Một PR = một thay đổi; không gộp nhiều tính năng.
- PR vào dev phải qua CI (lint + build).

## Cấu trúc thư mục
- Code chỉ một route dùng → đặt cạnh route đó. Dùng ở ≥ 2 route → `src/lib/` (logic) hoặc `src/components/` (UI).
- Server Actions: `actions.ts` cạnh route; mảng riêng thì `<mảng>-actions.ts`. Không đặt Server Action trong `src/lib/`.
- `page.tsx`/`layout.tsx` là Server Component; `"use client"` chỉ đặt ở component lá.
- File vượt 500 dòng → tách theo phần giao diện vào thư mục con (như `src/app/admin/posts/[id]/editor/`).
- Chuỗi hiển thị chỉ nằm trong `src/i18n/dict/<area>.ts`; `src/lib/` không chứa label.

## Đặt tên
- File, thư mục: kebab-case (`post-editor.tsx`).
- Component: PascalCase, named export; default export chỉ cho `page`/`layout` (`UsersPage`).
- Hàm: camelCase, bắt đầu bằng động từ (`savePost`). Trả boolean → `is*`/`can*`/`has*`; guard → `require*`; lấy dữ liệu → `get*`.
- Hằng số: SCREAMING_SNAKE, đơn vị ở hậu tố (`MIN_INTERVAL_MS`, `TRASH_DAYS`).
- Type: PascalCase, dùng `type` không dùng `interface`; props cục bộ tên `Props`. Zod schema trùng tên type suy ra (`SaveInput`).
- Kết quả action: `XxxResult = { ok: true; … } | { ok: false; error: string }`; form dùng `FormState`.
- DB: bảng, cột snake_case, bảng số nhiều; index `<bảng>_<cột>_idx` hoặc `_uq`.
- Activity action: `<entity>.<động_từ_quá_khứ>` (`post.published`). Log: tiền tố `[area]` (`[ai]`).
- Không có hai export cùng tên mà khác nghĩa trong `src/`.

## Code
- TS strict: không `any`, không `@ts-ignore`; `eslint-disable` phải kèm `-- lý do`.
- Không default param, không tham số boolean làm cờ (ngoại lệ: default của React props).
- Không nuốt lỗi. Ngoại lệ đã duyệt: `logActivity`, `notifySite` (chạy sau thao tác chính, không được làm hỏng nó).
- Kiểm quyền chỉ qua `PERMISSIONS` / `can*()` trong `src/lib/permissions.ts`; không so sánh role trực tiếp.
- Hiển thị ngày giờ luôn truyền `timeZone`: `getTimeZone()` ở server, prop `timeZone` ở client component (server chạy UTC).

## Server Action
- Thứ tự: `requireUser()` → zod `safeParse` → kiểm quyền → ghi DB → `logActivity` → `revalidatePath` → `notifySite` nếu website bị ảnh hưởng.
- Lỗi người dùng gặp được: trả `{ ok: false, error: t.… }`. Lỗi bất thường: `throw`.

## Ngôn ngữ
- Chuỗi hiển thị: thêm vào cả `vi` và `en` trong `src/i18n/dict/<area>.ts`.
- Comment code, log, lỗi dành cho dev: tiếng Anh.

## API công khai và webhook
- `/api/public/v1/**` và body webhook `{ site, slugs }` là hợp đồng với repo coauths-web1: chỉ được THÊM field,
  không đổi tên, xoá hay đổi kiểu. Thay đổi phá vỡ → tạo v2, hoặc sửa cả hai repo trong cùng một đợt, ghi rõ trong PR.
- API công khai chỉ trả bài đang live và chưa nằm trong thùng rác.

## Database
- Sửa schema → `npm run db:generate -- --name <mo_ta>`, commit cả file SQL lẫn `drizzle/meta/`.
  Không sửa migration đã merge vào dev; cần sửa thì tạo migration mới.
- Migration phải chạy được khi bản cũ còn đang chạy (cms-migrate chạy trước khi thay cms-web): cột mới thì nullable
  hoặc có default; xoá hay đổi tên cột thì chia hai PR (thêm cột mới + chuyển code → xoá cột cũ).
- Truy vấn `posts` luôn lọc `deletedAt`; truy vấn theo website luôn lọc `siteId`.
- Một thao tác ghi nhiều bảng → dùng `db.transaction`.
- Đổi ý nghĩa dữ liệu đã lưu (enum, shape của jsonb, trạng thái) → ghi ADR trước khi làm.

## Bảo mật
Nguyên tắc: mọi thứ trình duyệt gửi lên đều có thể bị sửa; chỉ tin những gì server tự kiểm tra.
- Server Action và API tự kiểm tra đăng nhập và quyền bên trong hàm. Ẩn nút trên UI không phải là bảo vệ.
- Dữ liệu từ client: kiểm tra bằng zod. HTML phải được làm sạch ở server trước khi lưu.
- Không đưa secret ra trình duyệt (không dùng tiền tố `NEXT_PUBLIC_` cho secret);
  không ghi token, mật khẩu, cookie vào log.

## Cấu hình
- Biến env mới → thêm vào `.env.example` kèm comment. Biến bắt buộc mà thiếu thì báo lỗi rõ ràng,
  không lặng lẽ dùng giá trị mặc định.

## Kiểm thử
- Sửa bug → thêm một check tái hiện bug vào `tests/e2e` trước, rồi mới sửa.
- Đổi quyền → cập nhật `tests/e2e/permissions.mjs`.

## Pull request
- Mô tả gồm: làm gì, vì sao, đã test bằng lệnh nào. Có migration, đổi API công khai hoặc thêm biến env → ghi rõ ngay dòng đầu.
- Thay đổi UI: kèm ảnh chụp trước và sau.
- Thêm dependency: nêu lý do trong PR.
