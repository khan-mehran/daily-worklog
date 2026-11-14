import { NextResponse } from "next/server";
import { authedRoute, parseBody } from "@/lib/api/handler";
import { createTemplate, listTemplates } from "@/lib/tasks/service";
import { createTemplateSchema } from "@/validators/task";

// A person keeps at most 50 templates, so the list is bounded without paging.
export const GET = authedRoute(async ({ user }) =>
  NextResponse.json({ data: await listTemplates(user) }),
);

export const POST = authedRoute(async ({ req, user }) => {
  const template = await createTemplate(user, await parseBody(req, createTemplateSchema));
  return NextResponse.json({ data: { id: String(template._id) } }, { status: 201 });
});
