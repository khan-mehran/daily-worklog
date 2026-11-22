import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { DEPARTMENT_FILTER_COOKIE, seesAllDepartments, type Role } from "@/lib/constants";
import { scopeFor } from "@/lib/permissions";
import { isId } from "@/validators/common";
import { getCurrentUser } from "./session";

const cachedUser = cache(getCurrentUser);

/** Server components: the signed-in user, or a redirect to /login. */
export async function requirePageUser() {
  const user = await cachedUser();
  // `expired` stops middleware bouncing a stale token straight back to the app.
  if (!user) redirect("/login?expired=1");
  return user;
}

/** Server components: pages outside the user's role are a 404, not a redirect. */
export async function requirePageRole(...roles: Role[]) {
  const user = await requirePageUser();
  if (!roles.includes(user.role)) notFound();
  return user;
}

/** The user, their switcher selection (CEO and Super Admin) and this page's department filter. */
export async function getPageScope() {
  const user = await requirePageUser();
  const cookie = (await cookies()).get(DEPARTMENT_FILTER_COOKIE)?.value ?? null;
  const selectedDepartmentId = seesAllDepartments(user.role) && isId(cookie) ? cookie : null;
  return { user, selectedDepartmentId, scope: scopeFor(user, selectedDepartmentId) };
}
