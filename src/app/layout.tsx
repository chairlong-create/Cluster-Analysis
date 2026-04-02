import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { SignOutButton } from "@/components/sign-out-button";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "对话聚类分析工作台",
  description: "本地运行的对话信号提取、聚类分类与类别管理工作台。",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const user = session?.user;

  return (
    <html lang="zh-CN">
      <body>
        {user && (
          <nav
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: 12,
              padding: "12px 24px",
              fontSize: "0.85rem",
              color: "var(--muted)",
            }}
          >
            <span>{user.name || user.email}</span>
            {(user as { role?: string }).role === "admin" && (
              <Link
                href="/admin"
                style={{
                  color: "var(--primary)",
                  fontWeight: 600,
                }}
              >
                用户管理
              </Link>
            )}
            <SignOutButton />
          </nav>
        )}
        {children}
      </body>
    </html>
  );
}
