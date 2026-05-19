import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { getPromptContent } from "@/lib/server/db";
import { nowIso, stableId } from "@/lib/server/crypto";
import { exportsDir } from "@/lib/server/paths";
import { exportRequestSchema } from "@/lib/shared/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = exportRequestSchema.parse(await request.json());
  const prompts = getPromptContent(body.promptIds);
  const markdown = [
    "# Promptbar Export",
    "",
    `Created: ${nowIso()}`,
    "",
    ...prompts.flatMap((prompt) => [
      `## ${prompt.title}`,
      "",
      `- ID: \`${prompt.id}\``,
      `- Kind: \`${prompt.kind}\``,
      `- Source: \`${prompt.sourcePath}\``,
      `- Tags: ${prompt.tags.join(", ") || "none"}`,
      "",
      "```text",
      prompt.content,
      "```",
      "",
    ]),
  ].join("\n");
  fs.mkdirSync(exportsDir, { recursive: true });
  const filePath = path.join(
    exportsDir,
    `promptbar-export-${stableId(nowIso(), markdown)}.md`,
  );
  fs.writeFileSync(filePath, markdown, "utf8");
  return NextResponse.json({ filePath, markdown });
}
