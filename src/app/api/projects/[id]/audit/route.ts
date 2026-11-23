import { NextResponse } from "next/server";
import { authedRoute, idParam } from "@/lib/api/handler";
import { checkProjectDependencies } from "@/lib/projects/service";

type Params = { id: string };

/** Runs the dependency audit for this project now. */
export const POST = authedRoute<Params>(async ({ params, user }) =>
  NextResponse.json({ data: await checkProjectDependencies(user, idParam(params.id)) }),
);
