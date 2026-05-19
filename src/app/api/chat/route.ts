import { streamChat } from "@/lib/server/ai";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

const chatSchema = z.object({
  messages: z.array(z.custom()).default([]),
  contextIds: z.array(z.string()).default([]),
});

export async function POST(request: Request) {
  const body = chatSchema.parse(await request.json());
  try {
    return await streamChat({
      messages: body.messages as never,
      contextIds: body.contextIds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(message, { status: 400 });
  }
}
