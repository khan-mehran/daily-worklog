import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute, parseQuery } from "@/lib/api/handler";
import { search } from "@/lib/search/service";

const searchQuerySchema = z.object({ q: z.string().trim().min(2).max(60) });

export const GET = authedRoute(async ({ req, user, selectedDepartmentId }) => {
  const { q } = parseQuery(req, searchQuerySchema);
  return NextResponse.json({ data: await search(user, selectedDepartmentId, q) });
});
