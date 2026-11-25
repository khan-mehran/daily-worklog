import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/api/handler";
import { bitbucketImportPreview, importBitbucketProjects } from "@/lib/projects/service";

/** The repositories in the manager's Bitbucket account that aren't projects yet. */
export const GET = authedRoute(async ({ user }) => NextResponse.json({ data: await bitbucketImportPreview(user) }));

/** Adds a project for each of them. */
export const POST = authedRoute(async ({ user }) =>
  NextResponse.json({ data: await importBitbucketProjects(user) }, { status: 201 }),
);
