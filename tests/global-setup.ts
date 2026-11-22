import { prepareDatabase, testDatabaseUrl } from "../scripts/test-db";

/**
 * Tests run against their own PostgreSQL database, on the server DATABASE_URL points at: the
 * development database's name with "_test" added. Set TEST_DATABASE_URL to use another one.
 */
export default async function setup() {
  const url = testDatabaseUrl("test", "TEST_DATABASE_URL");
  await prepareDatabase(url);
  process.env.DATABASE_URL = url;
}
