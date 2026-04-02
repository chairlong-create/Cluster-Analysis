"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      style={{
        background: "none",
        color: "var(--muted)",
        fontSize: "0.85rem",
        textDecoration: "underline",
        cursor: "pointer",
      }}
    >
      退出登录
    </button>
  );
}
