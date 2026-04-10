import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

export async function getCurrentUser() {
  const session = await auth();
  if (!session?.user?.id) {
    // Clear stale/invalid session cookies before redirecting.
    // Without this, middleware sees the cookie and passes through,
    // but auth() rejects it, creating a redirect cycle.
    const cookieStore = await cookies();
    cookieStore.delete("authjs.session-token");
    cookieStore.delete("__Secure-authjs.session-token");
    redirect("/login");
  }
  return {
    userId: session.user.id,
    role: (session.user as { role?: string }).role ?? "user",
  };
}

export async function requireAdmin() {
  const user = await getCurrentUser();
  if (user.role !== "admin") {
    throw new Error("Forbidden");
  }
  return user;
}

export function assertTaskOwnership(taskId: string, userId: string): void {
  const task = db
    .prepare(`SELECT id FROM tasks WHERE id = ? AND user_id = ?`)
    .get(taskId, userId);
  if (!task) {
    throw new Error("任务不存在");
  }
}
