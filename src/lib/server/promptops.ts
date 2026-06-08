import { execFileSync } from "node:child_process";

import "server-only";

import { embeddingModel, repoOpenAiKey } from "@/lib/server/env";
import { promptopsStateDir } from "@/lib/server/paths";

type PromptopsEnvelope<T> = {
  schema: "promptops.output.v1";
  data: T;
};

/**
 * Resolves the promptops executable and base arguments for local CLI calls.
 *
 * @returns The command and leading arguments used to invoke promptops.
 */
export function promptopsCommand(): { command: string; args: string[] } {
  if (process.env.PROMPTOPS_BIN) {
    return { command: process.env.PROMPTOPS_BIN, args: [] };
  }
  if (process.env.PROMPTOPS_USE_CARGO === "1") {
    return {
      command: "cargo",
      args: ["run", "-q", "-p", "promptops-cli", "--"],
    };
  }
  return { command: "promptops", args: [] };
}

/**
 * Runs promptops with `--json` and parses the stable output envelope.
 *
 * @param args - Promptops subcommand arguments after the global `--json` flag.
 * @param input - Optional stdin payload for commands that accept non-argv data.
 * @returns The parsed promptops JSON envelope.
 */
export function runPromptopsJson<T>(
  args: string[],
  input?: string,
): PromptopsEnvelope<T> {
  const command = promptopsCommand();
  const output = execFileSync(command.command, [...command.args, "--json", ...args], {
    encoding: "utf8",
    input,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      PROMPTOPS_STATE_DIR: promptopsStateDir,
      PROMPTOPS_EMBED_API_KEY:
        process.env.PROMPTOPS_EMBED_API_KEY ?? repoOpenAiKey() ?? undefined,
      PROMPTOPS_EMBED_MODEL:
        process.env.PROMPTOPS_EMBED_MODEL ?? embeddingModel(),
    },
  });
  return JSON.parse(output) as PromptopsEnvelope<T>;
}

/**
 * Verifies promptops can initialize and read its local state.
 */
export function ensurePromptopsReady(): void {
  runPromptopsJson(["doctor"]);
}
