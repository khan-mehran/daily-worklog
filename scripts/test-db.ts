// Databases for automated tests, kept apart from development data. Tests erase what they use, so
// they only ever get a database whose name ends in the suffix asked for here.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

/**
 * The URL of a test database on the same server as DATABASE_URL: the development database's name
 * with `suffix` added ("worklog" becomes "worklog_test"). `override` names an environment variable
 * that replaces it, for CI or a separate server.
 */
export function testDatabaseUrl(suffix: "test" | "e2e", override: string) {
  config({ path: ".env.local", quiet: true });
  config({ path: ".env", quiet: true });

  const base = process.env[override] ?? process.env.DATABASE_URL;
  if (!base) throw new Error(`Set DATABASE_URL (or ${override}) in .env.local to run these tests.`);
  const url = new URL(base);
  if (!process.env[override]) {
    url.pathname = `${url.pathname.replace(/_(test|e2e)$/, "")}_${suffix}`;
  }
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!new RegExp(`^[a-z0-9_]+_${suffix}$`, "i").test(name)) {
    throw new Error(`Refusing to run tests against "${name}": the database name must end in _${suffix}.`);
  }
  return url.toString();
}

/** Creates the database if it doesn't exist yet, then applies every migration to it. */
export async function prepareDatabase(databaseUrl: string) {
  const url = new URL(databaseUrl);
  const name = decodeURIComponent(url.pathname.slice(1));
  const maintenance = new URL(url);
  maintenance.pathname = "/postgres";
  const server = new PrismaClient({ datasourceUrl: maintenance.toString() });
  try {
    const found = await server.$queryRaw<unknown[]>`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (found.length === 0) await server.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await server.$disconnect();
  }

  // A plain path, because these scripts are loaded both as ES modules and as CommonJS.
  const cli = resolve("node_modules/prisma/build/index.js");
  const migrate = spawnSync(process.execPath, [cli, "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
  });
  if (migrate.status !== 0) {
    throw new Error(`Could not migrate "${name}":\n${migrate.stdout}\n${migrate.stderr}`);
  }
}
