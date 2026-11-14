import mongoose from "mongoose";

type Cache = { promise: Promise<typeof mongoose> | null };

// The cache lives on globalThis so hot reloads and route bundles share one connection.
const globalCache = globalThis as unknown as { __worklogMongoose?: Cache };
const cache: Cache = (globalCache.__worklogMongoose ??= { promise: null });

export async function connectDB() {
  if (!cache.promise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is not set. Copy .env.example to .env.local.");
    cache.promise = mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 }).catch((error) => {
      cache.promise = null;
      throw error;
    });
  }
  return cache.promise;
}

export async function disconnectDB() {
  await mongoose.disconnect();
  cache.promise = null;
}
