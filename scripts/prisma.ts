// Runs the Prisma CLI with the same env files as the app: `tsx scripts/prisma.ts migrate deploy`.
// Prisma only reads .env by itself, and this project keeps its settings in .env.local.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

// A plain path, because these scripts are loaded both as ES modules and as CommonJS.
const cli = resolve("node_modules/prisma/build/index.js");
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(result.status ?? 1);
