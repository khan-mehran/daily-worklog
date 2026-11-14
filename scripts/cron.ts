// A self-hosted alternative to vercel.json: calls the reminders endpoint every hour.
// Run beside the app with `npx tsx scripts/cron.ts`. The endpoint never sends a reminder twice.
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
setInterval(run, HOUR);
