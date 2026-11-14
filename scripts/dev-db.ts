// A local MongoDB for machines without Docker: `npm run db:dev`. Data persists in .data/mongo.
import { mkdirSync } from "node:fs";
import { connect } from "node:net";
import { resolve } from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server";

/** On Windows a second server can share the port silently, so check before starting one. */
function portIsInUse(port: number) {
  return new Promise<boolean>((done) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      done(true);
    });
    socket.once("error", () => done(false));
  });
}

async function main() {
  if (await portIsInUse(27017)) {
    console.log("MongoDB is already running on port 27017, so you don't need this command.");
    return;
  }
  const dbPath = resolve(".data/mongo");
  mkdirSync(dbPath, { recursive: true });

  const server = await MongoMemoryServer.create({
    instance: { port: 27017, dbPath, storageEngine: "wiredTiger" },
  });
  console.log(`MongoDB is running at ${server.getUri()} (data in ${dbPath}). Press Ctrl+C to stop.`);

  const stop = async () => {
    await server.stop({ doCleanup: false });
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
