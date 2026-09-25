# Qub-X Studio

CMS để viết và xuất bản bài blog song ngữ (Việt – Anh) cho website Qub-X. Website đọc bài qua API công khai; mỗi khi bài đã xuất bản thay đổi, CMS báo website làm mới ngay.

- Next.js 16 (App Router), Drizzle ORM, Postgres (PGlite khi chạy local), Tiptap.
- Website Qub-X nằm ở repo `coauths-web1` (`src/app/qubx`), đọc bài qua `src/app/qubx/_lib/cms-blog.ts`.

## Chạy trên máy

```bash
npm install
cp .env.example .env.local        # tuỳ chọn: local chạy được không cần biến nào
npm run db:seed -- --demo         # tạo website Qub-X + tài khoản, in mật khẩu ra màn hình
npm run db:import-qubx -- --replace   # nạp các bài blog hiện có của Qub-X
npm run dev                       # http://localhost:3000 (hoặc 3001 nếu cổng 3000 đang bận)
```

Database local nằm trong `.data/pglite` và chỉ cho **một tiến trình** mở cùng lúc: tắt `npm run dev` trước khi chạy các lệnh `db:*`.

Nối với website Qub-X chạy local: đặt cùng một giá trị `CMS_REVALIDATE_SECRET` trong `.env.local` của cả hai dự án, và `CMS_API_URL=http://localhost:3001` bên Qub-X. Vào **Cài đặt website** trong CMS, bấm **Gửi thử tín hiệu làm mới** để kiểm tra.

## Lệnh

| Lệnh | Việc |
|---|---|
| `npm run dev` | Chạy CMS |
| `npm run db:generate` | Tạo migration sau khi sửa `src/db/schema.ts` |
| `npm run db:migrate` | Áp migration (Postgres khi có `DATABASE_URL`, không thì PGlite) |
| `npm run db:seed` | Website Qub-X + tài khoản admin (mật khẩu ngẫu nhiên). `-- --demo`: thêm biên tập viên và người viết |
| `npm run db:import-qubx -- --replace` | Thay toàn bộ bài bằng các bài trong `scripts/data/qubx-blog.json` |
| `npm run test:e2e` | Kiểm thử đầu-cuối trên dev server đang chạy (xem `tests/e2e/run.mjs`) |
| `npm run test:browser` | Mở Chrome/Edge thật, soạn một bài có bảng, khung, video, xuất bản và kiểm tra Qub-X hiển thị đúng |
| `npm run test:ai` | Thử trợ lý AI với một API Anthropic giả (chạy CMS với `ANTHROPIC_API_KEY=fake ANTHROPIC_BASE_URL=http://localhost:3999`) |

## Trợ lý AI

Nút **AI** trong trang soạn bài viết bản nháp từ chủ đề, hoặc dịch bản ngôn ngữ kia sang (giữ bố cục, bảng, khung lưu ý; dùng bảng Thuật ngữ dịch). Kết quả chỉ điền vào trình soạn thảo, người viết đọc lại rồi mới lưu hay đăng. Mỗi lần dùng được ghi vào Nhật ký hoạt động.

- Bật bằng `ANTHROPIC_API_KEY` (tạo ở console.anthropic.com). `AI_MODEL` chọn model Claude, `AI_DAILY_LIMIT` giới hạn số lần mỗi người mỗi 24 giờ (mặc định 30).
- Giọng văn và đối tượng đọc của từng website nằm trong `SITE_BRIEFS` ở `src/lib/ai.ts`.

## Đưa lên server (ví dụ Vercel)

1. **Database**: tạo Postgres (Neon hoặc Supabase), đặt `DATABASE_URL`, chạy `npm run db:migrate` từ máy của bạn (hoặc trong bước build).
2. **Ảnh**: tạo bucket Cloudflare R2 (hoặc S3) có địa chỉ công khai, đặt các biến `S3_*`. Không có bước này, ảnh tải lên sẽ mất vì Vercel không giữ file.
3. **Biến môi trường**: `CMS_PUBLIC_URL`, `CMS_REVALIDATE_SECRET`, `CRON_SECRET` (xem `.env.example`).
4. **Tài khoản đầu tiên**: `SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… DATABASE_URL=… npm run db:seed`, rồi nạp bài: `npm run db:import-qubx -- --replace`.
5. **Hẹn giờ đăng bài**: cho một lịch chạy gọi `GET /api/cron/publish-scheduled` vài phút một lần (Vercel Cron, hoặc cron-job.org với header `Authorization: Bearer <CRON_SECRET>`). Không có lịch này, bài hẹn giờ vẫn lên đúng giờ nhưng website có thể chậm tới 5 phút.
6. **Website Qub-X** (Vercel của `coauths-web1`): đặt `CMS_API_URL=<địa chỉ CMS>` và cùng `CMS_REVALIDATE_SECRET`.
7. Trong CMS, **Cài đặt website → Qub-X**: đổi **URL làm mới** thành `https://www.qub-x.com/api/cms/revalidate`, bấm **Gửi thử**.
8. **Sao lưu**: bật sao lưu tự động / point-in-time restore của nhà cung cấp Postgres.

## API cho website

- `GET /api/public/v1/sites/{site}/posts?locale=vi|en`: bài đã xuất bản, mới nhất trước.
- `GET /api/public/v1/sites/{site}/posts/{slug}?locale=vi|en`: một bài, gồm nội dung Tiptap (`content`, mỗi H2 có `attrs.id`), mục lục `toc` và slug ở ngôn ngữ kia (`alternates`). Slug đã đổi trả `301 { movedTo }`.
- Khi bài thay đổi, CMS gửi `POST <URL làm mới>` với header `x-cms-secret` và body `{ site, slugs: { vi, en } }`.
