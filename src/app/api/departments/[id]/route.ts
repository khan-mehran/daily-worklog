import { NextResponse } from "next/server";
import { forbidden, notFound } from "@/lib/api/errors";
import { authedRoute, idParam, parseBody } from "@/lib/api/handler";
import { requireVisibleDepartment } from "@/lib/departments/access";
import {
  deleteDepartment,
  getDepartmentDetail,
  listDepartmentsWithStats,
  updateDepartment,
} from "@/lib/departments/service";
import { canManageDepartments } from "@/lib/permissions";
import { updateDepartmentSchema } from "@/validators/department";

type Params = { id: string };

export const GET = authedRoute<Params>(async ({ params, user }) => {
  const id = idParam(params.id);
  await requireVisibleDepartment(user, id);
  const data = canManageDepartments(user)
    ? await getDepartmentDetail(id)
    : (await listDepartmentsWithStats({ id }))[0];
  if (!data) throw notFound();
  return NextResponse.json({ data });
});

export const PATCH = authedRoute<Params>(async ({ req, params, user }) => {
  const id = idParam(params.id);
  await requireVisibleDepartment(user, id);
  if (!canManageDepartments(user)) throw forbidden();
  const department = await updateDepartment(user, id, await parseBody(req, updateDepartmentSchema));
  return NextResponse.json({ data: { id: department.id } });
});

export const DELETE = authedRoute<Params>(async ({ params, user }) => {
  const id = idParam(params.id);
  await requireVisibleDepartment(user, id);
  if (!canManageDepartments(user)) throw forbidden();
  await deleteDepartment(user, id);
  return NextResponse.json({ data: { id: params.id } });
});
