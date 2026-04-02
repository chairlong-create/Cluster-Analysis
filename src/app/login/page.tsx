"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const username = formData.get("username") as string;
    const password = formData.get("password") as string;

    const result = await signIn("credentials", {
      username,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("用户名或密码错误");
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        className="panel"
        style={{
          width: "100%",
          maxWidth: 400,
          padding: "40px 32px",
        }}
      >
        <p className="eyebrow" style={{ textAlign: "center" }}>
          Cluster Analysis
        </p>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "2.4rem",
            lineHeight: 0.92,
            letterSpacing: "-0.02em",
            textAlign: "center",
            marginTop: 10,
            marginBottom: 28,
          }}
        >
          登录
        </h1>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label
              htmlFor="username"
              style={{
                display: "block",
                marginBottom: 6,
                fontSize: "0.88rem",
                color: "var(--muted)",
              }}
            >
              用户名
            </label>
            <input
              id="username"
              name="username"
              type="text"
              required
              autoFocus
              autoComplete="username"
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label
              htmlFor="password"
              style={{
                display: "block",
                marginBottom: 6,
                fontSize: "0.88rem",
                color: "var(--muted)",
              }}
            >
              密码
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </div>

          {error && (
            <p
              style={{
                color: "var(--danger)",
                fontSize: "0.88rem",
                marginBottom: 16,
                textAlign: "center",
              }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "0.9rem 1rem",
              borderRadius: 14,
              background: "var(--primary)",
              color: "#fff",
              fontWeight: 600,
              fontSize: "1rem",
              opacity: loading ? 0.6 : 1,
              cursor: loading ? "wait" : "pointer",
            }}
          >
            {loading ? "登录中..." : "登录"}
          </button>
        </form>
      </div>
    </div>
  );
}
