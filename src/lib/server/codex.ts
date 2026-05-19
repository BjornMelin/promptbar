import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { getPromptContent } from "@/lib/server/db";
import { codexAvailable } from "@/lib/server/env";

const execFileAsync = promisify(execFile);

export async function runCodexBridge(input: {
  task: string;
  promptIds: string[];
}): Promise<{ ok: boolean; output: string }> {
  if (!codexAvailable()) {
    return { ok: false, output: "Codex CLI is not available on PATH." };
  }
  const prompts = getPromptContent(input.promptIds);
  const context = prompts
    .map((prompt, index) => {
      return [
        `Prompt ${index + 1}: ${prompt.title}`,
        prompt.content.slice(0, 5000),
      ].join("\n");
    })
    .join("\n\n---\n\n");
  const instruction = [
    "You are being invoked by Promptbar for an explicit local task.",
    "Operate read-only unless the user task explicitly asks for edits.",
    context ? `Selected prompt context:\n\n${context}` : "",
    `Task:\n${input.task}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const { stdout, stderr } = await execFileAsync(
      "codex",
      [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        instruction,
      ],
      {
        timeout: 120_000,
        maxBuffer: 1024 * 1024 * 4,
      },
    );
    return {
      ok: true,
      output: extractCodexFinal(stdout) || stderr || stdout,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, output: message };
  }
}

function extractCodexFinal(stdout: string): string {
  let final = "";
  for (const line of stdout.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const item = JSON.parse(line) as {
        type?: string;
        item?: { type?: string; text?: string };
      };
      if (item.type === "message" && item.item?.type === "final_answer") {
        final = item.item.text ?? final;
      }
    } catch {
      final = line;
    }
  }
  return final;
}
