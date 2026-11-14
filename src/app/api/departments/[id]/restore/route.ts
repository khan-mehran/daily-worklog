import { NextResponse } from "next/server";
import { forbidden } from "@/lib/api/errors";
import { authedRoute, objectIdParam } from "@/lib/api/handler";
import { requireVisibleDepartment } from "@/lib/departments/access";
import { setDepartmentArchived } from "@/lib/departments/service";
import { canManageDepartments } from "@/lib/permissions";

export const POST = authedRoute<{ id: string }>(async ({ params, user }) => {
  const id = objectIdParam(params.id);
  await requireVisibleDepartment(user, id);
  if (!canManageDepartments(user)) throw forbidden();
  const department = await setDepartmentArchived(user, id, false);
  return NextResponse.json({ data: { id: String(department._id), status: department.status } });
});
