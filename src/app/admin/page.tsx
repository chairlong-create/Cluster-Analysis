import Link from "next/link";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/current-user";
import { createUserAction, resetPasswordAction, deleteUserAction } from "./actions";

type UserRow = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  createdAt: string;
  taskCount: number;
};

export default async function AdminPage() {
  await requireAdmin();

  const users = db
    .prepare(`
      SELECT
        u.id,
        u.username,
        u.display_name AS displayName,
        u.role,
        u.created_at AS createdAt,
        (SELECT COUNT(*) FROM tasks t WHERE t.user_id = u.id) AS taskCount
      FROM users u
      ORDER BY u.created_at ASC
    `)
    .all() as UserRow[];

  return (
    <main className="shell">
      <section className="hero" style={{ marginBottom: 20 }}>
        <p className="eyebrow">Admin</p>
        <h1>用户管理</h1>
        <p className="heroCopy">
          <Link href="/" style={{ color: "var(--primary)", textDecoration: "underline" }}>
            返回首页
          </Link>
        </p>
      </section>

      <section className="panel" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: 16 }}>创建用户</h2>
        <form action={createUserAction} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: 4 }}>
              用户名
            </label>
            <input name="username" required style={{ width: 140 }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: 4 }}>
              显示名称
            </label>
            <input name="displayName" style={{ width: 140 }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: 4 }}>
              密码
            </label>
            <input name="password" type="password" required style={{ width: 140 }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: 4 }}>
              角色
            </label>
            <select name="role" defaultValue="user" style={{ width: 100 }}>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <button
            type="submit"
            style={{
              padding: "0.8rem 1.2rem",
              borderRadius: 14,
              background: "var(--primary)",
              color: "#fff",
              fontWeight: 600,
            }}
          >
            创建
          </button>
        </form>
      </section>

      <section className="panel">
        <h2 style={{ fontSize: "1.1rem", marginBottom: 16 }}>
          用户列表 ({users.length})
        </h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--surface-border)", textAlign: "left" }}>
              <th style={{ padding: "8px 6px" }}>用户名</th>
              <th style={{ padding: "8px 6px" }}>显示名称</th>
              <th style={{ padding: "8px 6px" }}>角色</th>
              <th style={{ padding: "8px 6px" }}>任务数</th>
              <th style={{ padding: "8px 6px" }}>创建时间</th>
              <th style={{ padding: "8px 6px" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} style={{ borderBottom: "1px solid var(--surface-border)" }}>
                <td style={{ padding: "8px 6px", fontWeight: 600 }}>{user.username}</td>
                <td style={{ padding: "8px 6px", color: "var(--muted)" }}>{user.displayName || "-"}</td>
                <td style={{ padding: "8px 6px" }}>
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 8,
                      fontSize: "0.78rem",
                      fontWeight: 600,
                      background: user.role === "admin" ? "var(--primary)" : "var(--surface-border)",
                      color: user.role === "admin" ? "#fff" : "var(--foreground)",
                    }}
                  >
                    {user.role}
                  </span>
                </td>
                <td style={{ padding: "8px 6px" }}>{user.taskCount}</td>
                <td style={{ padding: "8px 6px", color: "var(--muted)", fontSize: "0.82rem" }}>
                  {new Date(user.createdAt).toLocaleDateString("zh-CN")}
                </td>
                <td style={{ padding: "8px 6px" }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <form action={resetPasswordAction} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <input type="hidden" name="userId" value={user.id} />
                      <input
                        name="newPassword"
                        type="password"
                        placeholder="新密码"
                        required
                        style={{ width: 100, padding: "4px 8px", borderRadius: 8, fontSize: "0.82rem" }}
                      />
                      <button
                        type="submit"
                        style={{
                          padding: "4px 10px",
                          borderRadius: 8,
                          background: "var(--accent)",
                          color: "#fff",
                          fontSize: "0.78rem",
                          fontWeight: 600,
                        }}
                      >
                        重置
                      </button>
                    </form>
                    <form action={deleteUserAction}>
                      <input type="hidden" name="userId" value={user.id} />
                      <button
                        type="submit"
                        style={{
                          padding: "4px 10px",
                          borderRadius: 8,
                          background: "var(--danger)",
                          color: "#fff",
                          fontSize: "0.78rem",
                          fontWeight: 600,
                        }}
                      >
                        删除
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
