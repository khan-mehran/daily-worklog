import { MongoMemoryServer } from "mongodb-memory-server";

export default async function setup() {
  const server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri("worklog-test");
  return async () => {
    await server.stop();
  };
}
