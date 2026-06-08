import Database from "better-sqlite3";

import "server-only";

import { apiEnabled, codexAvailable } from "@/lib/server/env";
import { databasePath, defaultImportRoot } from "@/lib/server/paths";
import { ensurePromptopsReady, runPromptopsJson } from "@/lib/server/promptops";
import type {
  CorpusStats,
  EvalRun,
  Facets,
  PromptDetail,
  PromptKind,
  PromptStatus,
  PromptSummary,
  PromptVersion,
  SearchMode,
} from "@/lib/shared/types";

type Row = Record<string, unknown>;

let singleton: Database.Database | null = null;
let ensurePromptopsPromise: Promise<void> | null = null;
let promptopsStateReady = false;

/**
 * Ensures the promptops SQLite database and migrations exist before direct reads.
 *
 * @returns A promise that resolves after promptops has initialized local state.
 */
export async function ensurePromptopsStateReady(): Promise<void> {
  if (promptopsStateReady) {
    return;
  }
  ensurePromptopsPromise ??= ensurePromptopsReady().finally(() => {
    ensurePromptopsPromise = null;
  });
  await ensurePromptopsPromise;
  promptopsStateReady = true;
}

/**
 * Opens the singleton promptops SQLite database connection.
 *
 * @returns The configured better-sqlite3 database handle.
 */
export function db(): Database.Database {
  if (singleton) {
    return singleton;
  }
  singleton = new Database(databasePath);
  singleton.pragma("journal_mode = WAL");
  singleton.pragma("foreign_keys = ON");
  return singleton;
}

/**
 * Reads aggregate promptops corpus and runtime statistics.
 *
 * @returns Counts, storage metadata, and local runtime capability flags.
 */
export function stats(): CorpusStats {
  const conn = db();
  const one = (sql: string): number =>
    (conn.prepare(sql).get() as { count: number }).count;
  const latest = conn
    .prepare("SELECT MAX(created_at) AS latest FROM imports")
    .get() as { latest: string | null };
  return {
    documents: one("SELECT COUNT(*) AS count FROM documents"),
    chunks: one("SELECT COUNT(*) AS count FROM chunks"),
    favorites: one("SELECT COUNT(*) AS count FROM documents WHERE favorite=1"),
    risks: one("SELECT COUNT(*) AS count FROM documents WHERE risk_flags_json!='[]'"),
    evalRuns: one("SELECT COUNT(*) AS count FROM eval_runs"),
    embeddedChunks: one(
      "SELECT COUNT(*) AS count FROM chunks WHERE embedding IS NOT NULL",
    ),
    latestImportAt: latest.latest,
    apiEnabled: apiEnabled(),
    codexAvailable: codexAvailable(),
    defaultImportRoot: defaultImportRoot(),
  };
}

/**
 * Counts prompt documents available in the promptops database.
 *
 * @returns The total number of stored prompt documents.
 */
export function documentCount(): number {
  return (
    db().prepare("SELECT COUNT(*) AS count FROM documents").get() as {
      count: number;
    }
  ).count;
}

/**
 * Reads facet counts for prompt kind, status, tags, and risk flags.
 *
 * @returns Facet values grouped by filter category.
 */
export function facets(): Facets {
  return {
    kinds: facet("kind"),
    statuses: facet("status"),
    tags: jsonFacet("tags_json"),
    risks: jsonFacet("risk_flags_json"),
  };
}

function facet(column: string) {
  return db()
    .prepare(
      `
      SELECT ${column} AS value, COUNT(*) AS count
      FROM documents
      GROUP BY ${column}
      ORDER BY count DESC, value ASC
      LIMIT 100
      `,
    )
    .all() as { value: string; count: number }[];
}

function jsonFacet(column: string) {
  const counts = new Map<string, number>();
  const rows = db().prepare(`SELECT ${column} AS value FROM documents`).all();
  for (const row of rows as { value: string }[]) {
    for (const item of parseList(row.value)) {
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 100)
    .map(([value, count]) => ({ value, count }));
}

/**
 * Searches prompt documents with local SQLite FTS and metadata filters.
 *
 * @param input - Search query, filters, mode, and result limit.
 * @returns Matching prompt summaries ordered by relevance or update time.
 */
export function searchDocuments(input: {
  query: string;
  mode: SearchMode;
  kind?: string;
  status?: string;
  tag?: string;
  limit: number;
}): PromptSummary[] {
  const args: unknown[] = [];
  const where: string[] = [];
  if (input.kind) {
    where.push("d.kind = ?");
    args.push(input.kind);
  }
  if (input.status) {
    where.push("d.status = ?");
    args.push(input.status);
  }
  if (input.tag) {
    where.push("d.tags_json LIKE ?");
    args.push(`%"${input.tag}"%`);
  }

  const query = input.query.trim();
  let sql = "SELECT d.*, 0.0 AS score FROM documents d";
  if (query) {
    sql = `
      SELECT d.*, bm25(documents_fts) * -1.0 AS score
      FROM documents_fts
      JOIN documents d ON d.id = documents_fts.id
    `;
    where.push("documents_fts MATCH ?");
    args.push(ftsQuery(query));
  }

  const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const order = query ? "score DESC, d.updated_at DESC" : "d.updated_at DESC";
  return (db()
    .prepare(`${sql}${whereSql} ORDER BY ${order} LIMIT ?`)
    .all(...args, input.limit) as Row[]).map(summaryFromRow);
}

/**
 * Lists recent prompt documents for default corpus views.
 *
 * @param limit - Maximum number of prompt summaries to return.
 * @returns Recent prompt summaries ordered by update time.
 */
export function allSearchableDocuments(limit = 80): PromptSummary[] {
  return (db()
    .prepare("SELECT *, 0.0 AS score FROM documents ORDER BY updated_at DESC LIMIT ?")
    .all(limit) as Row[]).map(summaryFromRow);
}

/**
 * Loads a full prompt document by id.
 *
 * @param id - Prompt document id.
 * @param options - Controls whether raw, unredacted content is included.
 * @returns The prompt detail, or null when no prompt exists for the id.
 */
export function getPrompt(
  id: string,
  options: { includeRaw?: boolean } = {},
): PromptDetail | null {
  const row = db()
    .prepare("SELECT *, 0.0 AS score FROM documents WHERE id = ?")
    .get(id) as Row | undefined;
  if (!row) {
    return null;
  }
  const summary = summaryFromRow(row);
  const rawContent = String(row.content ?? "");
  const redactedContent = String(row.redacted_content ?? rawContent);
  return {
    ...summary,
    content: options.includeRaw ? rawContent : redactedContent,
    rawContent: options.includeRaw ? rawContent : undefined,
    redactedContent,
    frontmatter: parseObject(row.frontmatter_json),
    versions: listVersions(id),
    related: relatedPrompts(summary),
  };
}

/**
 * Loads raw prompt details for evaluation inputs.
 *
 * @param ids - Prompt document ids to load.
 * @returns Prompt details for ids that still exist.
 */
export function getPromptContent(ids: string[]): PromptDetail[] {
  return ids
    .map((id) => getPrompt(id, { includeRaw: true }))
    .filter((item): item is PromptDetail => !!item);
}

/**
 * Applies a prompt overlay patch through promptops.
 *
 * @param id - Prompt document id to patch.
 * @param patch - Overlay fields and optional edit reason.
 * @returns The refreshed prompt detail, or null when the prompt no longer exists.
 */
export async function patchPrompt(
  id: string,
  patch: {
    title?: string;
    content?: string;
    status?: PromptStatus;
    favorite?: boolean;
    tags?: string[];
    reason?: string;
  },
): Promise<PromptDetail | null> {
  const args = ["overlay", "patch", id];
  let input: string | undefined;
  if (patch.title) {
    args.push("--title", patch.title);
  }
  if (patch.content !== undefined) {
    args.push("--content-stdin");
    input = patch.content;
  }
  if (patch.status) {
    args.push("--status", patch.status);
  }
  if (patch.favorite !== undefined) {
    args.push("--favorite", String(patch.favorite));
  }
  if (patch.tags) {
    args.push("--tags", patch.tags.join(","));
  }
  if (patch.reason) {
    args.push("--reason", patch.reason);
  }
  await runPromptopsJson(args, input);
  resetDb();
  return getPrompt(id, { includeRaw: patch.content !== undefined });
}

function listVersions(documentId: string): PromptVersion[] {
  return db()
    .prepare(
      `
      SELECT
        id,
        document_id AS documentId,
        created_at AS createdAt,
        title,
        content_hash AS contentHash,
        content,
        reason
      FROM versions
      WHERE document_id = ?
      ORDER BY created_at DESC
      LIMIT 20
      `,
    )
    .all(documentId) as PromptVersion[];
}

function relatedPrompts(prompt: PromptSummary): PromptSummary[] {
  const tags = prompt.tags.slice(0, 3);
  if (!tags.length) {
    return [];
  }
  const clauses = tags.map(() => "tags_json LIKE ?").join(" OR ");
  return (db()
    .prepare(
      `
      SELECT *, 0.0 AS score FROM documents
      WHERE id != ? AND (${clauses})
      ORDER BY updated_at DESC
      LIMIT 6
      `,
    )
    .all(prompt.id, ...tags.map((tag) => `%"${tag}"%`)) as Row[]).map(
    summaryFromRow,
  );
}

/**
 * Persists an evaluation run through promptops.
 *
 * @param run - Evaluation run payload to store.
 * @returns A promise that resolves after the run has been saved.
 */
export async function saveEvalRun(run: EvalRun): Promise<void> {
  await runPromptopsJson(
    [
      "eval",
      "save",
      "--id",
      run.id,
      "--created-at",
      run.createdAt,
      "--mode",
      run.mode,
      "--model",
      run.model,
    ],
    JSON.stringify(run),
  );
  resetDb();
}

/**
 * Reads recent evaluation runs from promptops state.
 *
 * @param limit - Maximum number of runs to return.
 * @returns Recent evaluation run payloads.
 */
export function recentEvalRuns(limit = 10): EvalRun[] {
  const rows = db()
    .prepare(
      `
      SELECT payload_json AS payload
      FROM eval_runs
      ORDER BY created_at DESC
      LIMIT ?
      `,
    )
    .all(limit) as { payload: string }[];
  return rows.map((row) => JSON.parse(row.payload) as EvalRun);
}

function summaryFromRow(row: Row): PromptSummary {
  return {
    id: String(row.id),
    title: String(row.title),
    kind: String(row.kind) as PromptKind,
    status: String(row.status) as PromptStatus,
    favorite: Boolean(row.favorite),
    tags: parseList(row.tags_json),
    riskFlags: parseList(row.risk_flags_json),
    sourcePath: String(row.source_path),
    corpusPath: String(row.corpus_path),
    excerpt: String(row.excerpt),
    contentHash: String(row.content_hash),
    updatedAt: String(row.updated_at),
    score: Number(row.score ?? 0),
  };
}

function parseList(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function resetDb(): void {
  singleton?.close();
  singleton = null;
}

function ftsQuery(value: string): string {
  const terms = value
    .split(/\s+/)
    .map((term) => term.replace(/["*]/g, "").trim())
    .filter((term) => term.length > 1)
    .slice(0, 12);
  return terms.map((term) => `"${term}"*`).join(" OR ") || '""';
}
