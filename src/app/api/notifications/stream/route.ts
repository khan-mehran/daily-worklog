import { authedRoute } from "@/lib/api/handler";
import { serialiseNotification } from "@/lib/notifications/serialise";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const POLL_MS = 5000;
const HEARTBEAT_EVERY = 5;

/**
 * Server-Sent Events: new notifications and the unread count, for this user only. It checks the
 * database every few seconds, which needs no extra infrastructure and no connection held open.
 * The client falls back to polling every 30 seconds if the stream drops.
 */
export const GET = authedRoute(async ({ req, user }) => {
  const encoder = new TextEncoder();
  let since = new Date();
  let lastUnread = -1;
  let ticks = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const close = () => {
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      const tick = async () => {
        try {
          const fresh = await prisma.notification.findMany({
            where: { recipientId: user.id, createdAt: { gt: since } },
            orderBy: { createdAt: "asc" },
            take: 20,
          });
          if (fresh.length > 0) {
            since = fresh.at(-1)!.createdAt;
            for (const notification of fresh) send("notification", serialiseNotification(notification));
          }
          const unread = await prisma.notification.count({ where: { recipientId: user.id, readAt: null } });
          if (unread !== lastUnread) {
            lastUnread = unread;
            send("unread", { count: unread });
          }
          if (++ticks % HEARTBEAT_EVERY === 0) controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          close();
        }
      };

      req.signal.addEventListener("abort", close);
      await tick();
      timer = setInterval(tick, POLL_MS);
    },
    cancel() {
      clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
