import { authedRoute, parseQuery } from "@/lib/api/handler";
import { exportQuerySchema, exportTasks } from "@/lib/export/tasks";

export const GET = authedRoute(async ({ req, user, selectedDepartmentId }) =>
  exportTasks(user, selectedDepartmentId, parseQuery(req, exportQuerySchema)),
);
