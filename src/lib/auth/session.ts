import type { PaletteColor, Role, ThemePreference } from "@/lib/constants";
import { prisma } from "@/lib/db/prisma";
import { maySignIn } from "@/lib/permissions";
import { isId } from "@/validators/common";
import { auth } from "./index";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  departmentId: string | null;
  reportsTo: string | null;
  avatarColor: PaletteColor;
  preferences: {
    theme: ThemePreference;
    emailNotifications: boolean;
    inAppNotifications: boolean;
  };
}

/**
 * The signed-in user, read fresh from the database on every request. The JWT only proves
 * identity, so role changes, department moves and deactivation take effect immediately.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return loadActiveUser(session.user.id);
}

/**
 * An approved, active user by id, in the CurrentUser shape. Null for anyone else: unknown,
 * deactivated, still waiting for approval, or rejected.
 */
export async function loadActiveUser(id: string): Promise<CurrentUser | null> {
  // A session cookie from before the move to PostgreSQL carries an id that can't exist here.
  if (!isId(id)) return null;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || !maySignIn(user)) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    departmentId: user.departmentId,
    reportsTo: user.reportsTo,
    avatarColor: user.avatarColor as PaletteColor,
    preferences: {
      theme: user.theme,
      emailNotifications: user.emailNotifications,
      inAppNotifications: user.inAppNotifications,
    },
  };
}
