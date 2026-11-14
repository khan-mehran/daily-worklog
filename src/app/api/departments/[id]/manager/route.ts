import { NextResponse } from "next/server";
import { forbidden } from "@/lib/api/errors";
import { authedRoute, objectIdParam, parseBody } from "@/lib/api/handler";
import { requireVisibleDepartment } from "@/lib/departments/access";
import { changeDepartmentManager } from "@/lib/departments/service";
import { canManageDepartments } from "@/lib/permissions";
import { managerAssignmentSchema } from "@/validators/department";

export const POST = authedRoute<{ id: string }>(async ({ req, params, user }) => {
  const id = objectIdParam(params.id);
  await requireVisibleDepartment(user, id);
  if (!canManageDepartments(user)) throw forbidden();
  const assignment = await parseBody(req, managerAssignmentSchema);
  const department = await changeDepartmentManager(user, id, assignment);
  return NextResponse.json({ data: { id: String(department._id) } });
});
