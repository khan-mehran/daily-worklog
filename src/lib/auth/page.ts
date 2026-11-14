import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Types } from "mongoose";
import { cache } from "react";
import { DEPARTMENT_FILTER_COOKIE, type Role } from "@/lib/constants";
import { scopeFor } from "@/lib/permissions";
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

/** The user, their switcher selection (CEO only) and the department filter for this page. */
export async function getPageScope() {
  const user = await requirePageUser();
  const cookie = (await cookies()).get(DEPARTMENT_FILTER_COOKIE)?.value ?? null;
  const selectedDepartmentId =
    user.role === "CEO" && cookie && Types.ObjectId.isValid(cookie) ? cookie : null;
  return { user, selectedDepartmentId, scope: scopeFor(user, selectedDepartmentId) };
}
