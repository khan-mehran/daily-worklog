import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db/prisma";
import { maySignIn } from "@/lib/permissions";
import { isId } from "@/validators/common";
import { authConfig } from "./config";
import { userIdFromTicket } from "./entra";

// Microsoft is the only way in. There are no passwords in GET List.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    // The last step of Microsoft sign-in. The callback route has already checked the person with
    // Microsoft and hands over a short-lived ticket signed with AUTH_SECRET, which a browser can't
    // forge. Auth.js calls this a "credentials" provider, but nobody types anything into it.
    Credentials({
      id: "microsoft",
      name: "Microsoft",
      credentials: { ticket: {} },
      async authorize(credentials) {
        const userId = userIdFromTicket(credentials?.ticket);
        if (!userId || !isId(userId)) return null;
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user || !maySignIn(user)) return null;
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          departmentId: user.departmentId,
        };
      },
    }),
  ],
});
