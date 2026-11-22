import { defineConfig, devices } from "@playwright/test";
import { testDatabaseUrl } from "./scripts/test-db";

// A dedicated port, so these tests can never run against another app on the default port 3000.
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
// These tests reseed and change data, so they use their own database and never your dev data:
// by default the development database's name with "_e2e" added.
export const E2E_DATABASE_URL = testDatabaseUrl("e2e", "E2E_DATABASE_URL");

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // A production build: it's what users get, and it needs far less memory than a dev server.
    command: `npx next build && npx next start -p ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 400_000,
    env: {
      APP_URL: BASE_URL,
      DATABASE_URL: E2E_DATABASE_URL,
      NEXT_DIST_DIR: ".next-e2e",
      // Browser tests sign in with passwords and must never send real mail.
      SENDGRID_API_KEY: "",
    },
  },
});
