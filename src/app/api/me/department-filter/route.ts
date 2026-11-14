import { NextResponse } from "next/server";
import { notFound } from "@/lib/api/errors";
import { authedRoute, parseBody } from "@/lib/api/handler";
import { DEPARTMENT_FILTER_COOKIE } from "@/lib/constants";
import { isCEO } from "@/lib/permissions";
import { Department } from "@/models";
import { departmentFilterSchema } from "@/validators/user";

// The CEO's department switcher. Other roles have no switcher, so for them this route doesn't exist.
export const PUT = authedRoute(async ({ req, user }) => {
  if (!isCEO(user)) throw notFound();
  const { departmentId } = await parseBody(req, departmentFilterSchema);
  if (departmentId && !(await Department.exists({ _id: departmentId }))) throw notFound();

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
