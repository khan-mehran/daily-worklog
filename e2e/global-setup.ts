import { execSync } from "node:child_process";
import { E2E_MONGODB_URI } from "../playwright.config";

export default function globalSetup() {
  execSync("npm run seed", {
    stdio: "inherit",
    env: { ...process.env, MONGODB_URI: E2E_MONGODB_URI },
  });
}
