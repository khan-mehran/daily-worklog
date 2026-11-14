import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { consumeRateLimit } from "@/lib/api/rate-limit";
import { connectDB } from "@/lib/db/connect";
import { User } from "@/models";
import { loginSchema } from "@/validators/auth";
import { authConfig } from "./config";
import { verifyPassword } from "./password";

class RateLimited extends CredentialsSignin {
  code = "rate_limited";
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        await connectDB();
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
        const [emailAllowed, ipAllowed] = await Promise.all([
          consumeRateLimit(`login:email:${email}`, 10, LOGIN_WINDOW_MS),
          consumeRateLimit(`login:ip:${ip}`, 50, LOGIN_WINDOW_MS),
        ]);
        if (!emailAllowed || !ipAllowed) throw new RateLimited();

        const user = await User.findOne({ email }).select("+passwordHash").lean();
        const valid = await verifyPassword(password, user?.passwordHash);
        if (!user || !valid || !user.isActive) return null;

        return {
          id: String(user._id),
          name: user.name,
          email: user.email,
          role: user.role,
          departmentId: user.departmentId ? String(user.departmentId) : null,
        };
      },
    }),
  ],
});
