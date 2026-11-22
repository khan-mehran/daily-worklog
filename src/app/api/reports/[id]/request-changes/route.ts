import { NextResponse } from "next/server";
import { authedRoute, idParam, parseBody } from "@/lib/api/handler";
import { transitionReport } from "@/lib/reports/service";
import { requestChangesSchema } from "@/validators/report";

export const POST = authedRoute<{ id: string }>(async ({ req, params, user }) => {
  const id = idParam(params.id);
  const { comment } = await parseBody(req, requestChangesSchema);
  const report = await transitionReport(user, id, "requestChanges", comment);
  return NextResponse.json({ data: { id: params.id, status: report.status } });
});
