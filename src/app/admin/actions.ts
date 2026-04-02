"use server";

import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/current-user";

export async function createUserAction(formData: FormData) {
  await requireAdmin();

  const username = (formData.get("username") as string)?.trim();
  const displayName = (formData.get("displayName") as string)?.trim() || "";
  const password = formData.get("password") as string;
  const role = formData.get("role") as string;

  if (!username || username.length < 2) {
    throw new Error("用户名至少 2 个字符");
  }
  if (!password || password.length < 4) {
    throw new Error("密码至少 4 个字符");
  }
  if (!["admin", "user"].includes(role)) {
    throw new Error("角色无效");
  }

  const existing = db.prepare(`SELECT id FROM users WHERE username = ?`).get(username);
  if (existing) {
    throw new Error("用户名已存在");
  }

  const now = new Date().toISOString();
  const hash = bcrypt.hashSync(password, 10);

  db.prepare(`
    INSERT INTO users (id, username, password_hash, display_name, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), username, hash, displayName, role, now, now);

  revalidatePath("/admin");
}

export async function resetPasswordAction(formData: FormData) {
  await requireAdmin();

  const userId = formData.get("userId") as string;
  const newPassword = formData.get("newPassword") as string;

  if (!newPassword || newPassword.length < 4) {
    throw new Error("新密码至少 4 个字符");
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  const now = new Date().toISOString();

  db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).run(hash, now, userId);

  revalidatePath("/admin");
}

export async function deleteUserAction(formData: FormData) {
  await requireAdmin();

  const userId = formData.get("userId") as string;

  const user = db.prepare(`SELECT id, role FROM users WHERE id = ?`).get(userId) as
    | { id: string; role: string }
    | undefined;

  if (!user) {
    throw new Error("用户不存在");
  }

  const adminCount = db.prepare(`SELECT COUNT(*) AS count FROM users WHERE role = 'admin'`).get() as {
    count: number;
  };

  if (user.role === "admin" && adminCount.count <= 1) {
    throw new Error("不能删除最后一个管理员");
  }

  db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
  revalidatePath("/admin");
}
