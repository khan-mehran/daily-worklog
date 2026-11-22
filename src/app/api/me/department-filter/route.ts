import { NextResponse } from "next/server";
import { notFound } from "@/lib/api/errors";
import { authedRoute, parseBody } from "@/lib/api/handler";
import { DEPARTMENT_FILTER_COOKIE } from "@/lib/constants";
import { prisma } from "@/lib/db/prisma";
import { isOrgWide } from "@/lib/permissions";
import { departmentFilterSchema } from "@/validators/user";

// The department switcher of the CEO and Super Admin. Other roles have none, so for them this
// route doesn't exist.
export const PUT = authedRoute(async ({ req, user }) => {
  if (!isOrgWide(user)) throw notFound();
  const { departmentId } = await parseBody(req, departmentFilterSchema);
  if (departmentId && !(await prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } }))) {
    throw notFound();
  }

  const response = NextResponse.json({ data: { departmentId } });
  if (departmentId) {
    response.cookies.set(DEPARTMENT_FILTER_COOKIE, departmentId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  } else {
    response.cookies.delete(DEPARTMENT_FILTER_COOKIE);
  }
  return response;
});
