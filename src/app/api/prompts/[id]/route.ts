import { NextResponse } from "next/server";

import {
  ensurePromptopsStateReady,
  getPrompt,
  patchPrompt,
} from "@/lib/server/db";
import { promptPatchSchema } from "@/lib/shared/schemas";

export const runtime = "nodejs";

/**
 * Loads one prompt document for the editor or reveal flow.
 *
 * @param request - Incoming HTTP request with optional `raw=1` query flag.
 * @param context - Route context whose awaited `params.id` is the prompt id.
 * @returns A JSON response with `{ prompt }`, or a 404 JSON error.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await ensurePromptopsStateReady();
  const { id } = await context.params;
  const includeRaw = new URL(request.url).searchParams.get("raw") === "1";
  const prompt = getPrompt(id, { includeRaw });
  if (!prompt) {
    return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  }
  return NextResponse.json({ prompt });
}

/**
 * Applies validated editor changes to one prompt document.
 *
 * @param request - Incoming HTTP request with a `promptPatchSchema` JSON body.
 * @param context - Route context whose awaited `params.id` is the prompt id.
 * @returns A JSON response with the updated prompt, or a 404 JSON error.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await ensurePromptopsStateReady();
  const { id } = await context.params;
  const body = promptPatchSchema.parse(await request.json());
  const prompt = await patchPrompt(id, body);
  if (!prompt) {
    return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  }
  return NextResponse.json({ prompt });
}
