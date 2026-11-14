import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, tooManyRequests } from "@/lib/api/errors";
import { authedRoute, parseBody } from "@/lib/api/handler";
import { consumeRateLimit } from "@/lib/api/rate-limit";
import { AiUnavailableError, getAiService } from "@/lib/ai";

const AI_REQUESTS_PER_HOUR = 30;

const improveSchema = z.object({
  text: z
    .string({ error: "Write something to improve first" })
    .trim()
    .min(3, "Write something to improve first")
    .max(1000, "AI works on up to 1000 characters"),
});

const unavailable = (message: string) => new ApiError(503, "AI_UNAVAILABLE", message);

export const POST = authedRoute(async ({ req, user }) => {
  const { text } = await parseBody(req, improveSchema);
  const ai = getAiService();
  if (!ai) throw unavailable("The AI writing assistant isn't set up on this server.");
  if (!(await consumeRateLimit(`ai:${user.id}`, AI_REQUESTS_PER_HOUR, 60 * 60 * 1000))) {
    throw tooManyRequests(`You've used AI ${AI_REQUESTS_PER_HOUR} times this hour. Try again later.`);
  }

  try {
    return NextResponse.json({ data: { text: await ai.improveWorkLog(text) } });
  } catch (error) {
    if (error instanceof AiUnavailableError) throw unavailable("The AI assistant couldn't rewrite this entry.");
    if (error instanceof Anthropic.RateLimitError) throw unavailable("The AI assistant is busy. Try again in a minute.");
    if (error instanceof Anthropic.AuthenticationError) {
      console.error("[ai] the Anthropic API key was rejected");
      throw unavailable("The AI writing assistant isn't set up correctly on this server.");
    }
    if (error instanceof Anthropic.APIError) {
      console.error("[ai] API error", error.status, error.message);
      throw unavailable("The AI assistant couldn't respond just now.");
    }
    throw error;
  }
});
