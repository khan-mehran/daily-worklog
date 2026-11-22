import { execSync } from "node:child_process";
import { prepareDatabase } from "../scripts/test-db";
import { E2E_DATABASE_URL } from "../playwright.config";

export default async function globalSetup() {
  await prepareDatabase(E2E_DATABASE_URL);
  execSync("npm run seed", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
  });
}
