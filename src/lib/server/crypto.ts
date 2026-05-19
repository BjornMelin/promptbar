import { createHash } from "node:crypto";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableId(...parts: string[]): string {
  return sha256(parts.join("\0")).slice(0, 24);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function excerpt(value: string, limit = 240): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) {
    return compact;
  }
  return `${compact.slice(0, limit - 1)}…`;
}

export function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}
