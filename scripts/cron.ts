// A self-hosted alternative to vercel.json: calls the reminders endpoint now, then on every hour,
// so the Thursday 6 PM auto-submit happens at 6 PM. Run beside the app with `npx tsx scripts/cron.ts`.
// The endpoint never sends a reminder or submits a report twice.
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const HOUR = 60 * 60 * 1000;
const url = `${process.env.APP_URL ?? "http://localhost:3000"}/api/cron/reminders`;

async function run() {
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    console.log(new Date().toISOString(), response.status, await response.text());
  } catch (error) {
    console.error(new Date().toISOString(), "reminders failed", error);
  }
}

void run();
// Wait for the top of the next hour, then keep to it.
setTimeout(() => {
  void run();
  setInterval(run, HOUR);
}, HOUR - (Date.now() % HOUR));
