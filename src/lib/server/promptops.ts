import { execFileSync } from "node:child_process";

import "server-only";

import { promptopsStateDir } from "@/lib/server/paths";

type PromptopsEnvelope<T> = {
  schema: "promptops.output.v1";
  data: T;
};

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
    },
  });
  return JSON.parse(output) as PromptopsEnvelope<T>;
}

export function ensurePromptopsReady(): void {
  runPromptopsJson(["doctor"]);
}
