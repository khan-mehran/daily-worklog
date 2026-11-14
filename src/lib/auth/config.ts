import type { NextAuthConfig } from "next-auth";
import type { Role } from "@/lib/constants";

/** Edge-safe part of the Auth.js config, shared with middleware. No database imports here. */
export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.role = user.role;
        token.departmentId = user.departmentId;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub as string;
      session.user.role = token.role as Role;
      session.user.departmentId = (token.departmentId as string | null) ?? null;
      return session;
    },
  },
} satisfies NextAuthConfig;
