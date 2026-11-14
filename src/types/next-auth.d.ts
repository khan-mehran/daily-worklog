import type { DefaultSession } from "next-auth";
import type { Role } from "@/lib/constants";

declare module "next-auth" {
  interface User {
    role: Role;
    departmentId: string | null;
  }
  interface Session {
    user: { id: string; role: Role; departmentId: string | null } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: Role;
    departmentId?: string | null;
  }
}
