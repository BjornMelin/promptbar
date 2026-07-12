import { NextResponse } from "next/server";

import { exportsDir } from "@/lib/server/paths";
import { runPromptopsJson } from "@/lib/server/promptops";
import { exportRequestSchema } from "@/lib/shared/schemas";

export const runtime = "nodejs";

/**
 * Exports selected prompts to redacted markdown files through promptops.
 *
 * @param request - Request with JSON body validated by `exportRequestSchema`.
 * @returns JSON containing the first file path, all exported files, and count.
 */
export async function POST(request: Request) {
  const body = exportRequestSchema.parse(await request.json());
  const envelope = await runPromptopsJson<{
    files: string[];
    exported: number;
  }>(["export", "--out", exportsDir, ...body.promptIds]);
  return NextResponse.json({
    filePath: envelope.data.files[0] ?? exportsDir,
    files: envelope.data.files,
    exported: envelope.data.exported,
  });
}
