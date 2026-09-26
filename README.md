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

## Đưa lên server (Docker)

CMS chạy bằng Docker cùng Postgres: xem hướng dẫn đầu file `docker-compose.yml`. Mỗi lần push lên `main`, CI (`.github/workflows/ci.yml`) build image, đẩy lên GHCR rồi deploy lên staging `cms.dev.coauths.com` (`docker-compose.vps.yml`).

1. **Database**: container `cms-postgres` trong `docker-compose.yml`; `cms-migrate` tự chạy migration trước mỗi lần khởi động.
2. **Ảnh**: trên staging, ảnh nằm trong MinIO riêng của CMS (`cms-minio` trong `docker-compose.vps.yml`) và được đọc công khai (chỉ đọc) ở `<CMS_PUBLIC_URL>/media/` qua edge proxy. Cần tạo một lần trên server: `/opt/cms/.env.minio` (`MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`) và thêm `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` vào `/opt/cms/.env`; `cms-minio-init` tự tạo bucket và user chỉ-upload cho app. Máy local dùng MinIO: `docker compose -f docker-compose.minio.yml up -d`, xem `.env.example`.
3. **Biến môi trường**: `POSTGRES_PASSWORD`, `CMS_PUBLIC_URL`, `CMS_REVALIDATE_SECRET`, `CRON_SECRET` (xem `.env.example`).
4. **Tài khoản đầu tiên**: `docker compose run --rm cms-migrate npm run db:seed` (với `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`); chép bài từ máy local: `npm run db:copy-to-postgres`.
5. **Hẹn giờ đăng bài**: container `cms-cron` gọi `GET /api/cron/publish-scheduled` 5 phút một lần với header `Authorization: Bearer <CRON_SECRET>`.
6. **Website Qub-X** (Vercel của `coauths-web1`): đặt `CMS_API_URL=<địa chỉ CMS>` và cùng `CMS_REVALIDATE_SECRET`.
7. Trong CMS, **Cài đặt website → Qub-X**: đổi **URL làm mới** thành `https://www.qub-x.com/api/cms/revalidate`, bấm **Gửi thử**.
8. **Sao lưu**: bật sao lưu tự động / point-in-time restore của nhà cung cấp Postgres.

## API cho website

- `GET /api/public/v1/sites/{site}/posts?locale=vi|en`: bài đã xuất bản, mới nhất trước.
- `GET /api/public/v1/sites/{site}/posts/{slug}?locale=vi|en`: một bài, gồm nội dung Tiptap (`content`, mỗi H2 có `attrs.id`), mục lục `toc` và slug ở ngôn ngữ kia (`alternates`). Slug đã đổi trả `301 { movedTo }`.
- Khi bài thay đổi, CMS gửi `POST <URL làm mới>` với header `x-cms-secret` và body `{ site, slugs: { vi, en } }`.
