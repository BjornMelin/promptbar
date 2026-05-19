import { execFileSync } from "node:child_process";

export function repoOpenAiKey(): string | null {
  const value = process.env.PROMPTBAR_OPENAI_API_KEY?.trim();
  return value ? value : null;
}

export function apiEnabled(): boolean {
  return repoOpenAiKey() !== null;
}

export function openAiModel(): string {
  return process.env.PROMPTBAR_OPENAI_MODEL?.trim() || "gpt-5.5";
}

export function embeddingModel(): string {
  return (
    process.env.PROMPTBAR_EMBEDDING_MODEL?.trim() || "text-embedding-3-small"
  );
}

export function codexAvailable(): boolean {
  try {
    execFileSync("codex", ["--version"], {
      stdio: "ignore",
      timeout: 2000,
    });
    return true;
  } catch {
    return false;
  }
}
