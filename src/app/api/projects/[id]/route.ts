import { NextResponse } from "next/server";
import { notFound } from "@/lib/api/errors";
import { authedRoute, idParam, parseBody } from "@/lib/api/handler";
import { deleteProject, getProjectDetail, updateProject } from "@/lib/projects/service";
import { updateProjectSchema } from "@/validators/project";

type Params = { id: string };

export const GET = authedRoute<Params>(async ({ params, user }) => {
  const project = await getProjectDetail(user, idParam(params.id));
  if (!project) throw notFound();
  return NextResponse.json({ data: project });
});

export const PATCH = authedRoute<Params>(async ({ req, params, user }) => {
  const id = idParam(params.id);
  const project = await updateProject(user, id, await parseBody(req, updateProjectSchema));
  return NextResponse.json({ data: { id: project.id } });
});

export const DELETE = authedRoute<Params>(async ({ params, user }) => {
  await deleteProject(user, idParam(params.id));
  return NextResponse.json({ data: { id: params.id } });
});
