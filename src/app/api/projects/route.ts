import { NextResponse } from "next/server";
import { authedRoute, parseBody, parseQuery } from "@/lib/api/handler";
import { createProject, listProjects } from "@/lib/projects/service";
import { createProjectSchema, listProjectsQuerySchema } from "@/validators/project";

export const GET = authedRoute(async ({ req, user, selectedDepartmentId }) => {
  const query = parseQuery(req, listProjectsQuerySchema);
  const { projects, total } = await listProjects(user, selectedDepartmentId, query);
  return NextResponse.json({
    data: projects,
    meta: { page: query.page, limit: query.limit, total },
  });
});

export const POST = authedRoute(async ({ req, user }) => {
  const project = await createProject(user, await parseBody(req, createProjectSchema));
  return NextResponse.json({ data: { id: String(project._id) } }, { status: 201 });
});
