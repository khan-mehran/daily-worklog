import { connectDB } from "@/lib/db/connect";
import type { PaletteColor, Role, ThemePreference } from "@/lib/constants";
import { User } from "@/models";
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

/** An active user by id, in the CurrentUser shape. Null for unknown or deactivated users. */
export async function loadActiveUser(id: string): Promise<CurrentUser | null> {
  await connectDB();
  const user = await User.findById(id).lean();
  if (!user || !user.isActive) return null;
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    departmentId: user.departmentId ? String(user.departmentId) : null,
    reportsTo: user.reportsTo ? String(user.reportsTo) : null,
    avatarColor: user.avatarColor,
    preferences: user.preferences,
  };
}
