import { notFound } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { isOrgWide, type Actor } from "@/lib/permissions";

/** Another department gets a 404 before any role check, so its existence isn't revealed. */
export async function requireVisibleDepartment(actor: Actor, id: string) {
  if (!isOrgWide(actor) && actor.departmentId !== id) throw notFound();
  if (!(await prisma.department.findUnique({ where: { id }, select: { id: true } }))) throw notFound();
}
