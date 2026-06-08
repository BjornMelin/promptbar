import { NextResponse } from "next/server";

import { getPrompt, patchPrompt } from "@/lib/server/db";
import { promptPatchSchema } from "@/lib/shared/schemas";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const includeRaw = new URL(request.url).searchParams.get("raw") === "1";
  const prompt = getPrompt(id, { includeRaw });
  if (!prompt) {
    return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  }
  return NextResponse.json({ prompt });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = promptPatchSchema.parse(await request.json());
  const prompt = patchPrompt(id, body);
  if (!prompt) {
    return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  }
  return NextResponse.json({ prompt });
}
