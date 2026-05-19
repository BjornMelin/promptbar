import { NextResponse } from "next/server";

import { runCodexBridge } from "@/lib/server/codex";
import { codexRequestSchema } from "@/lib/shared/schemas";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const body = codexRequestSchema.parse(await request.json());
  const result = await runCodexBridge(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
