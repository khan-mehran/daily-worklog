import { authedRoute, idParam } from "@/lib/api/handler";
import { exportWeeklyReport } from "@/lib/export/tasks";

export const GET = authedRoute<{ id: string }>(async ({ params, user }) =>
  exportWeeklyReport(user, idParam(params.id)),
);
