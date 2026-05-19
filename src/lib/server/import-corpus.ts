import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import fg from "fast-glob";

import { recordImport, upsertDocument } from "@/lib/server/db";
import { corpusDir } from "@/lib/server/paths";
import { nowIso, sha256, stableId } from "@/lib/server/crypto";
import type { ImportReport, PromptKind } from "@/lib/shared/types";

const CONTENT_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
]);

const ROOT_LANES = new Set([
  "canon",
  "sources",
  "references",
  "projects",
  "archive",
  "manifests",
  "tools",
]);

type RawRecord = {
  record_id?: unknown;
  record_type?: unknown;
  captured_at_utc?: unknown;
  local_date?: unknown;
  cwd?: unknown;
  tags?: unknown;
  risk_flags?: unknown;
  content?: unknown;
  metadata?: unknown;
};

export async function importCorpus(root: string): Promise<ImportReport> {
  const resolvedRoot = path.resolve(root);
  const at = nowIso();
  const files = discoverFiles(resolvedRoot);
  let imported = 0;
  let skipped = 0;
  let rawRecords = 0;

  for (const file of files) {
    const absolute = path.join(resolvedRoot, file);
    const ext = path.extname(file).toLowerCase();
    if (!CONTENT_EXTENSIONS.has(ext)) {
      skipped += 1;
      continue;
    }
    if (ext === ".jsonl" && file.includes("raw-prompts")) {
      const result = importRawJsonl(resolvedRoot, file, absolute, at);
      imported += result.imported;
      skipped += result.skipped;
      rawRecords += result.rawRecords;
      continue;
    }
    const text = readText(absolute);
    if (!text.trim()) {
      skipped += 1;
      continue;
    }
    importDocument({
      root: resolvedRoot,
      relativePath: file,
      content: text,
      at,
      sourceRecordId: null,
      sourceType: "file",
      extraTags: [],
      riskFlags: riskFlags(text),
    });
    imported += 1;
  }

  const report: ImportReport = {
    root: resolvedRoot,
    imported,
    skipped,
    rawRecords,
    files: files.length,
    at,
  };
  recordImport({
    id: stableId(resolvedRoot, at, String(imported)),
    root: resolvedRoot,
    imported,
    skipped,
    rawRecords,
    files: files.length,
    createdAt: at,
  });
  return report;
}

function discoverFiles(root: string): string[] {
  const gitDir = path.join(root, ".git");
  if (fs.existsSync(gitDir)) {
    try {
      const output = execFileSync(
        "git",
        ["ls-files", "--cached", "--others", "--exclude-standard"],
        { cwd: root, encoding: "utf8", timeout: 15_000 },
      );
      return output
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean)
        .filter(allowedPath)
        .sort();
    } catch {
      return globFiles(root);
    }
  }
  return globFiles(root);
}

function globFiles(root: string): string[] {
  return fg
    .sync(["**/*"], {
      cwd: root,
      dot: false,
      onlyFiles: true,
      ignore: [
        ".git/**",
        "node_modules/**",
        ".venv/**",
        "generated/**",
        "**/*.sqlite*",
        "**/uv.lock",
      ],
    })
    .filter(allowedPath);
}

function allowedPath(relativePath: string): boolean {
  const first = relativePath.split(path.sep)[0] ?? "";
  if (!ROOT_LANES.has(first)) {
    return false;
  }
  if (relativePath.startsWith("generated/")) {
    return false;
  }
  if (relativePath.includes("/dogfood-output/")) {
    return false;
  }
  return CONTENT_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

function importRawJsonl(
  root: string,
  relativePath: string,
  absolutePath: string,
  at: string,
): { imported: number; skipped: number; rawRecords: number } {
  let imported = 0;
  let skipped = 0;
  let rawRecords = 0;
  const lines = readText(absolutePath).split("\n");
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    try {
      const record = JSON.parse(line) as RawRecord;
      const content = typeof record.content === "string" ? record.content : "";
      const recordId =
        typeof record.record_id === "string"
          ? record.record_id
          : stableId(relativePath, content);
      if (!content.trim()) {
        skipped += 1;
        continue;
      }
      rawRecords += 1;
      importDocument({
        root,
        relativePath,
        content,
        at,
        sourceRecordId: recordId,
        sourceType: "codex-jsonl",
        extraTags: normalizeList(record.tags),
        riskFlags: [
          ...new Set([
            ...normalizeList(record.risk_flags),
            ...riskFlags(content),
          ]),
        ],
        rawMetadata: record,
      });
      imported += 1;
    } catch {
      skipped += 1;
    }
  }
  return { imported, skipped, rawRecords };
}

function importDocument(input: {
  root: string;
  relativePath: string;
  content: string;
  at: string;
  sourceRecordId: string | null;
  sourceType: string;
  extraTags: string[];
  riskFlags: string[];
  rawMetadata?: RawRecord;
}): void {
  const kind = kindForPath(input.relativePath, input.sourceType);
  const title = titleForContent(input.content, input.relativePath);
  const contentHash = sha256(input.content);
  const id = stableId(
    input.relativePath,
    input.sourceRecordId ?? "",
    contentHash,
  );
  const corpusPath = path.join(corpusDir, kind, `${id}.md`);
  const tags = [
    ...new Set([
      ...tagsForPath(input.relativePath),
      ...intentTags(input.content),
      ...input.extraTags,
    ]),
  ].sort();

  upsertDocument({
    id,
    title,
    kind,
    tags,
    riskFlags: input.riskFlags,
    sourcePath: path.join(input.root, input.relativePath),
    corpusPath,
    content: input.content,
    importedAt: input.at,
    frontmatter: {
      id,
      title,
      kind,
      sourcePath: input.relativePath,
      sourceRecordId: input.sourceRecordId,
      sourceType: input.sourceType,
      importedAt: input.at,
      contentHash,
      metadata: input.rawMetadata?.metadata ?? {},
    },
  });
}

function readText(file: string): string {
  const stat = fs.statSync(file);
  if (stat.size > 4 * 1024 * 1024) {
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

function kindForPath(relativePath: string, sourceType: string): PromptKind {
  if (sourceType === "codex-jsonl") {
    return "codex-raw";
  }
  if (relativePath.startsWith("canon/")) {
    return "canon";
  }
  if (relativePath.startsWith("references/")) {
    return "reference";
  }
  if (relativePath.startsWith("projects/")) {
    return "project";
  }
  if (relativePath.startsWith("archive/")) {
    return "archive";
  }
  if (relativePath.startsWith("manifests/")) {
    return "manifest";
  }
  return "imported";
}

function titleForContent(content: string, relativePath: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) {
    return heading.slice(0, 140);
  }
  return path
    .basename(relativePath, path.extname(relativePath))
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function tagsForPath(relativePath: string): string[] {
  return relativePath
    .split(/[/.]/)
    .filter((part) => part.length > 2)
    .filter((part) => !/^\d+$/.test(part))
    .slice(0, 8)
    .map((part) => part.toLowerCase().replace(/[^a-z0-9-]/g, ""));
}

function intentTags(content: string): string[] {
  const lower = content.toLowerCase();
  const pairs: Array<[string, string[]]> = [
    ["ui", ["ui", "ux", "frontend", "design"]],
    ["research", ["research", "docs", "source", "evidence"]],
    ["review", ["review", "audit", "risk", "finding"]],
    ["debug", ["debug", "triage", "root cause", "failure"]],
    ["deploy", ["deploy", "release", "ci", "vercel"]],
    ["python", ["python", "pytest", "ruff", "uv "]],
    ["typescript", ["typescript", "react", "next.js", "bun"]],
    ["security", ["security", "secret", "auth", "token"]],
  ];
  return pairs
    .filter(([, needles]) => needles.some((needle) => lower.includes(needle)))
    .map(([tag]) => tag);
}

function riskFlags(content: string): string[] {
  const flags: string[] = [];
  if (/\bsk-(?:proj|live|test)?[A-Za-z0-9_-]{20,}\b/.test(content)) {
    flags.push("openai-key-like");
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content)) {
    flags.push("private-key-marker");
  }
  if (/\b(password|secret|token|api[_-]?key)\b/i.test(content)) {
    flags.push("sensitive-keyword");
  }
  return flags;
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.toLowerCase().trim())
    .filter(Boolean);
}
