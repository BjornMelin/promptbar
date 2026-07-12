import { NextResponse } from "next/server";

import { generateRefinement } from "../../../lib/server/ai";
import { ensurePromptopsStateReady, getPrompt } from "../../../lib/server/db";
import { repoOpenAiKey } from "../../../lib/server/env";
import {
  refinementRequestSchema,
  refinementResponseSchema,
} from "../../../lib/shared/schemas";

export const runtime = "nodejs";

/**
 * Generates one cited prompt refinement from selected redacted prompt content.
 *
 * @param request - Request containing selected prompt ids and a refinement goal.
 * @returns A validated refinement, or a bounded JSON error response.
 */
export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = refinementRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!repoOpenAiKey()) {
    return NextResponse.json(
      { error: "PROMPTBAR_OPENAI_API_KEY is not configured." },
      { status: 503 },
    );
  }

  await ensurePromptopsStateReady();
  const prompts = [];
  for (const id of parsed.data.promptIds) {
    const prompt = getPrompt(id, { includeRaw: false });
    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found." }, { status: 404 });
    }
    prompts.push({
      id: prompt.id,
      title: prompt.title,
      content: prompt.content,
    });
  }

  try {
    const refinement = await generateRefinement({
      instruction: parsed.data.instruction,
      prompts,
    });
    const response = refinementResponseSchema.safeParse(refinement);
    if (!response.success) {
      throw new Error("Generated refinement failed validation.");
    }
    return NextResponse.json(response.data);
  } catch {
    return NextResponse.json(
      { error: "Unable to generate refinement." },
      { status: 502 },
    );
  }
}
