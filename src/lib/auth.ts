import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        username: { label: "用户名", type: "text" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;

        const user = db
          .prepare(
            `SELECT id, username, password_hash, display_name, role FROM users WHERE username = ?`,
          )
          .get(credentials.username as string) as
          | { id: string; username: string; password_hash: string; display_name: string; role: string }
          | undefined;

        if (!user) return null;

        const valid = bcrypt.compareSync(
          credentials.password as string,
          user.password_hash,
        );
        if (!valid) return null;

        return {
          id: user.id,
          name: user.display_name || user.username,
          email: user.username,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
});
