import type { Types } from "mongoose";
import { notFound } from "@/lib/api/errors";
import { isCEO, type Actor } from "@/lib/permissions";
import { Department } from "@/models";

/** Another department gets a 404 before any role check, so its existence isn't revealed. */
export async function requireVisibleDepartment(actor: Actor, id: Types.ObjectId) {
  if (!isCEO(actor) && actor.departmentId !== String(id)) throw notFound();
  if (!(await Department.exists({ _id: id }))) throw notFound();
}
