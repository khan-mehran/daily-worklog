// A self-hosted alternative to vercel.json: calls the reminders and dependency audit endpoints
// now, then on every hour, so the Thursday 6 PM auto-submit happens at 6 PM. Run beside the app
// with `npx tsx scripts/cron.ts`. The reminders endpoint never sends a reminder or submits a
// report twice, and the audit endpoint only checks projects it hasn't checked today.
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const HOUR = 60 * 60 * 1000;
const base = `${process.env.APP_URL ?? "http://localhost:3000"}/api/cron`;

async function call(job: "reminders" | "audit") {
  try {
    const response = await fetch(`${base}/${job}`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    console.log(new Date().toISOString(), job, response.status, await response.text());
  } catch (error) {
    console.error(new Date().toISOString(), `${job} failed`, error);
  }
}

async function run() {
  await call("reminders");
  await call("audit");
}

void run();
// Wait for the top of the next hour, then keep to it.
setTimeout(() => {
  void run();
  setInterval(run, HOUR);
}, HOUR - (Date.now() % HOUR));
