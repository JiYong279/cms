import type { PostStatus, Role } from "@/db/schema";

export const ROLES: Role[] = ["admin", "editor", "writer"];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Quản trị",
  editor: "Biên tập",
  writer: "Người viết",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  admin: "Toàn quyền, kể cả tạo tài khoản và phân quyền.",
  editor: "Duyệt, sửa và xuất bản bài của mọi người.",
  writer: "Viết bài của mình và gửi duyệt, không tự xuất bản.",
};

export const ROLE_BADGE: Record<Role, string> = {
  admin: "bg-violet-100 text-violet-700",
  editor: "bg-sky-100 text-sky-700",
  writer: "bg-zinc-100 text-zinc-600",
};

/** Every capability in the CMS and the roles that hold it. The single source of truth for access. */
export const PERMISSIONS = {
  "posts.create": { label: "Viết bài mới", roles: ["admin", "editor", "writer"] },
  "posts.editOwn": { label: "Sửa bài của mình (khi chưa xuất bản)", roles: ["admin", "editor", "writer"] },
  "posts.editAny": { label: "Xem và sửa bài của mọi người", roles: ["admin", "editor"] },
  "posts.publish": { label: "Xuất bản, hẹn giờ, gỡ bài", roles: ["admin", "editor"] },
  "posts.deleteAny": { label: "Xoá bài của mọi người, xoá vĩnh viễn khỏi thùng rác", roles: ["admin", "editor"] },
  "activity.view": { label: "Xem nhật ký hoạt động", roles: ["admin", "editor"] },
  "users.manage": { label: "Quản lý người dùng và phân quyền", roles: ["admin"] },
  "sites.manage": { label: "Cài đặt website (domain, đường dẫn blog, kết nối)", roles: ["admin"] },
} satisfies Record<string, { label: string; roles: Role[] }>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission) {
  return (PERMISSIONS[permission].roles as readonly Role[]).includes(role);
}

type Actor = { id: string; role: Role };

export function isLive(status: PostStatus) {
  return status === "published" || status === "scheduled";
}

export function canEditPost(user: Actor, post: { authorId: string | null }) {
  return can(user.role, "posts.editAny") || post.authorId === user.id;
}

/** Writers may change their own article only while no language of it is live. */
export function canEditTranslation(user: Actor, status: PostStatus | null) {
  return can(user.role, "posts.publish") || !status || !isLive(status);
}

export function canDeletePost(user: Actor, post: { authorId: string | null }, statuses: PostStatus[]) {
  if (can(user.role, "posts.deleteAny")) return true;
  return post.authorId === user.id && !statuses.some(isLive);
}
