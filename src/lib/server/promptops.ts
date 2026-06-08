import { execFile } from "node:child_process";

import "server-only";

import { embeddingModel, repoOpenAiKey } from "@/lib/server/env";
import { promptopsStateDir } from "@/lib/server/paths";

type PromptopsEnvelope<T> = {
  schema: "promptops.output.v1";
  data: T;
};

const PROMPTOPS_TIMEOUT_MS = 60_000;
const PROMPTOPS_MAX_BUFFER = 32 * 1024 * 1024;

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
export async function runPromptopsJson<T>(
  args: string[],
  input?: string,
): Promise<PromptopsEnvelope<T>> {
  const command = promptopsCommand();
  const fullArgs = [...command.args, "--json", ...args];
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      command.command,
      fullArgs,
      {
        encoding: "utf8",
        maxBuffer: PROMPTOPS_MAX_BUFFER,
        timeout: PROMPTOPS_TIMEOUT_MS,
        killSignal: "SIGTERM",
        env: {
          ...process.env,
          PROMPTOPS_STATE_DIR: promptopsStateDir,
          PROMPTOPS_EMBED_API_KEY:
            process.env.PROMPTOPS_EMBED_API_KEY ?? repoOpenAiKey() ?? undefined,
          PROMPTOPS_EMBED_MODEL:
            process.env.PROMPTOPS_EMBED_MODEL ?? embeddingModel(),
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.trim() || error.message;
          reject(new Error(`promptops ${args[0] ?? "command"} failed: ${detail}`));
          return;
        }
        resolve(stdout);
      },
    );
    child.stdin?.end(input);
  });
  try {
    return JSON.parse(output) as PromptopsEnvelope<T>;
  } catch (error) {
    throw new Error(
      `promptops ${args[0] ?? "command"} returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Verifies promptops can initialize and read its local state.
 */
export async function ensurePromptopsReady(): Promise<void> {
  await runPromptopsJson(["doctor"]);
}
