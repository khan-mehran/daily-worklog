// Brings an existing database up to date without touching its data: `npm run db:migrate`.
// Safe to run any number of times.
import { config } from "dotenv";
import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../src/lib/db/connect";
import { ApiToken, Notification, Task, TaskTemplate, WeeklyReport } from "../src/models";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  await connectDB();
  console.log(`Migrating ${mongoose.connection.db!.databaseName} ...`);

  // Phase 3+: tasks carry a copy of their report's status, so the approval gate is one filter.
  let updated = 0;
  const reports = WeeklyReport.find().select("_id status").lean().cursor();
  for await (const report of reports) {
    const result = await Task.updateMany(
      { weeklyReportId: report._id, reportStatus: { $ne: report.status } },
      { reportStatus: report.status },
    );
    updated += result.modifiedCount;
  }
  console.log(`Tasks given their report status: ${updated}`);

  await Promise.all([Task.syncIndexes(), Notification.syncIndexes(), WeeklyReport.syncIndexes(), TaskTemplate.createIndexes(), ApiToken.createIndexes()]);
  console.log("Indexes are up to date.");
  await disconnectDB();
}

main().catch(async (error) => {
  console.error(error);
  await disconnectDB();
  process.exit(1);
});
