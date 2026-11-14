import { NextResponse } from "next/server";
import { forbidden } from "@/lib/api/errors";
import { authedRoute, parseBody } from "@/lib/api/handler";
import { createDepartment, listDepartmentsWithStats } from "@/lib/departments/service";
import { canManageDepartments, departmentCollectionScope } from "@/lib/permissions";
import { createDepartmentSchema } from "@/validators/department";

// The number of departments is small and controlled by the CEO, so this list isn't paginated.
export const GET = authedRoute(async ({ user }) =>
  NextResponse.json({ data: await listDepartmentsWithStats(departmentCollectionScope(user)) }),
);

export const POST = authedRoute(async ({ req, user }) => {
  if (!canManageDepartments(user)) throw forbidden();
  const department = await createDepartment(user, await parseBody(req, createDepartmentSchema));
  return NextResponse.json({ data: { id: String(department._id) } }, { status: 201 });
});
