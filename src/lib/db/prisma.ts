import { PrismaClient } from "@prisma/client";

// The client lives on globalThis so hot reloads and route bundles share one connection pool.
const globalCache = globalThis as unknown as { __getlPrisma?: PrismaClient };

export const prisma = (globalCache.__getlPrisma ??= new PrismaClient());

/** True when a write broke a unique index, such as two requests creating the same row at once. */
export const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === "P2002";
