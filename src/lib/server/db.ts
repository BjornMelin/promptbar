import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { apiEnabled, codexAvailable, embeddingModel } from "@/lib/server/env";
import {
  corpusDir,
  databasePath,
  defaultImportRoot,
  exportsDir,
  stateDir,
  versionsDir,
} from "@/lib/server/paths";
import {
  estimateTokens,
  excerpt,
  nowIso,
  sha256,
  stableId,
} from "@/lib/server/crypto";
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

type DocumentInput = {
  id: string;
  title: string;
  kind: PromptKind;
  status?: PromptStatus;
  favorite?: boolean;
  tags: string[];
  riskFlags: string[];
  sourcePath: string;
  corpusPath: string;
  content: string;
  frontmatter: Record<string, unknown>;
  importedAt: string;
};

export type ChunkRow = {
  id: string;
  documentId: string;
  content: string;
  contentHash: string;
  embedding: Buffer | null;
  embeddingModel: string | null;
  embeddingDim: number | null;
};

let singleton: Database.Database | null = null;

export function db(): Database.Database {
  if (singleton) {
    return singleton;
  }
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(corpusDir, { recursive: true });
  fs.mkdirSync(exportsDir, { recursive: true });
  fs.mkdirSync(versionsDir, { recursive: true });

  singleton = new Database(databasePath);
  singleton.pragma("journal_mode = WAL");
  singleton.pragma("foreign_keys = ON");
  initialize(singleton);
  return singleton;
}

function initialize(conn: Database.Database): void {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'inbox',
      favorite INTEGER NOT NULL DEFAULT 0,
      tags_json TEXT NOT NULL DEFAULT '[]',
      risk_flags_json TEXT NOT NULL DEFAULT '[]',
      source_path TEXT NOT NULL,
      corpus_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      content TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      frontmatter_json TEXT NOT NULL DEFAULT '{}',
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      token_estimate INTEGER NOT NULL,
      embedding_model TEXT,
      embedding_dim INTEGER,
      embedding BLOB,
      FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      content TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS eval_runs (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      mode TEXT NOT NULL,
      model TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS imports (
      id TEXT PRIMARY KEY,
      root TEXT NOT NULL,
      imported INTEGER NOT NULL,
      skipped INTEGER NOT NULL,
      raw_records INTEGER NOT NULL,
      files INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts
    USING fts5(id UNINDEXED, title, tags, source_path, content);

    CREATE INDEX IF NOT EXISTS idx_documents_kind
    ON documents(kind);
    CREATE INDEX IF NOT EXISTS idx_documents_status
    ON documents(status);
    CREATE INDEX IF NOT EXISTS idx_documents_hash
    ON documents(content_hash);
    CREATE INDEX IF NOT EXISTS idx_chunks_document
    ON chunks(document_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_embedding
    ON chunks(embedding_model, embedding_dim);
  `);
}

export function upsertDocument(input: DocumentInput): void {
  const conn = db();
  const contentHash = sha256(input.content);
  const updatedAt = nowIso();

  const existing = conn
    .prepare("SELECT id FROM documents WHERE id = ?")
    .get(input.id);

  conn
    .prepare(
      `
      INSERT INTO documents (
        id, title, kind, status, favorite, tags_json, risk_flags_json,
        source_path, corpus_path, content_hash, content, excerpt,
        frontmatter_json, imported_at, updated_at
      )
      VALUES (
        @id, @title, @kind, @status, @favorite, @tagsJson, @riskFlagsJson,
        @sourcePath, @corpusPath, @contentHash, @content, @excerpt,
        @frontmatterJson, @importedAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        kind = excluded.kind,
        tags_json = excluded.tags_json,
        risk_flags_json = excluded.risk_flags_json,
        source_path = excluded.source_path,
        corpus_path = excluded.corpus_path,
        content_hash = excluded.content_hash,
        content = excluded.content,
        excerpt = excluded.excerpt,
        frontmatter_json = excluded.frontmatter_json,
        updated_at = excluded.updated_at
      `,
    )
    .run({
      id: input.id,
      title: input.title,
      kind: input.kind,
      status: input.status ?? "inbox",
      favorite: input.favorite ? 1 : 0,
      tagsJson: JSON.stringify(input.tags),
      riskFlagsJson: JSON.stringify(input.riskFlags),
      sourcePath: input.sourcePath,
      corpusPath: input.corpusPath,
      contentHash,
      content: input.content,
      excerpt: excerpt(input.content),
      frontmatterJson: JSON.stringify(input.frontmatter),
      importedAt: input.importedAt,
      updatedAt,
    });

  if (!existing) {
    writeManagedFile(input.corpusPath, input);
  }
  replaceChunks(input.id, input.content);
  refreshFts(input.id);
}

export function writeManagedFile(
  corpusPath: string,
  input: Pick<DocumentInput, "title" | "content" | "frontmatter">,
): void {
  fs.mkdirSync(path.dirname(corpusPath), { recursive: true });
  const frontmatter = JSON.stringify(input.frontmatter, null, 2);
  const body = `---\n${frontmatter}\n---\n\n${input.content.trim()}\n`;
  fs.writeFileSync(corpusPath, body, "utf8");
}

function replaceChunks(documentId: string, content: string): void {
  const conn = db();
  conn.prepare("DELETE FROM chunks WHERE document_id = ?").run(documentId);
  const chunks = chunkContent(content);
  const insert = conn.prepare(`
    INSERT INTO chunks (
      id, document_id, ordinal, content, content_hash, token_estimate
    )
    VALUES (@id, @documentId, @ordinal, @content, @hash, @tokens)
  `);
  for (const [index, chunk] of chunks.entries()) {
    insert.run({
      id: stableId(documentId, String(index), sha256(chunk)),
      documentId,
      ordinal: index,
      content: chunk,
      hash: sha256(chunk),
      tokens: estimateTokens(chunk),
    });
  }
}

function chunkContent(content: string): string[] {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > 1800 && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = next;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks.length ? chunks : [content.trim()].filter(Boolean);
}

function refreshFts(documentId: string): void {
  const conn = db();
  const row = conn
    .prepare("SELECT * FROM documents WHERE id = ?")
    .get(documentId) as Row | undefined;
  if (!row) {
    return;
  }
  conn.prepare("DELETE FROM documents_fts WHERE id = ?").run(documentId);
  conn
    .prepare(
      `
      INSERT INTO documents_fts(id, title, tags, source_path, content)
      VALUES (@id, @title, @tags, @sourcePath, @content)
      `,
    )
    .run({
      id: row.id,
      title: row.title,
      tags: parseList(row.tags_json).join(" "),
      sourcePath: row.source_path,
      content: row.content,
    });
}

export function recordImport(input: {
  id: string;
  root: string;
  imported: number;
  skipped: number;
  rawRecords: number;
  files: number;
  createdAt: string;
}): void {
  db()
    .prepare(
      `
      INSERT INTO imports(
        id, root, imported, skipped, raw_records, files, created_at
      )
      VALUES(
        @id, @root, @imported, @skipped, @rawRecords, @files, @createdAt
      )
      `,
    )
    .run(input);
}

export function documentCount(): number {
  const row = db().prepare("SELECT COUNT(*) AS count FROM documents").get() as {
    count: number;
  };
  return row.count;
}

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
    risks: one(
      "SELECT COUNT(*) AS count FROM documents WHERE risk_flags_json!='[]'",
    ),
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

export function facets(): Facets {
  return {
    kinds: facet("kind", "documents"),
    statuses: facet("status", "documents"),
    tags: jsonFacet("tags_json", "documents"),
    risks: jsonFacet("risk_flags_json", "documents"),
  };
}

function facet(column: string, table: string) {
  const rows = db()
    .prepare(
      `
      SELECT ${column} AS value, COUNT(*) AS count
      FROM ${table}
      GROUP BY ${column}
      ORDER BY count DESC, value ASC
      LIMIT 100
      `,
    )
    .all() as { value: string; count: number }[];
  return rows;
}

function jsonFacet(column: string, table: string) {
  const counts = new Map<string, number>();
  const rows = db().prepare(`SELECT ${column} AS value FROM ${table}`).all();
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
  let sql = "SELECT d.*, 0 AS score FROM documents d";
  if (query) {
    sql = `
      SELECT d.*, bm25(documents_fts) * -1 AS score
      FROM documents_fts
      JOIN documents d ON d.id = documents_fts.id
    `;
    where.push("documents_fts MATCH ?");
    args.push(ftsQuery(query));
  }

  const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const order = query ? "score DESC" : "d.updated_at DESC";
  const rows = db()
    .prepare(`${sql}${whereSql} ORDER BY ${order} LIMIT ?`)
    .all(...args, input.limit) as Row[];
  return rows.map(summaryFromRow);
}

export function allSearchableDocuments(limit = 80): PromptSummary[] {
  const rows = db()
    .prepare(
      "SELECT *, 0 AS score FROM documents ORDER BY updated_at DESC LIMIT ?",
    )
    .all(limit) as Row[];
  return rows.map(summaryFromRow);
}

export function getPrompt(id: string): PromptDetail | null {
  const row = db()
    .prepare("SELECT *, 0 AS score FROM documents WHERE id = ?")
    .get(id) as Row | undefined;
  if (!row) {
    return null;
  }
  const detail = summaryFromRow(row) as PromptDetail;
  detail.content = String(row.content ?? "");
  detail.frontmatter = parseObject(row.frontmatter_json);
  detail.versions = listVersions(id);
  detail.related = relatedPrompts(detail);
  return detail;
}

export function getPromptContent(ids: string[]): PromptDetail[] {
  return ids.map(getPrompt).filter((item): item is PromptDetail => !!item);
}

export function patchPrompt(
  id: string,
  patch: {
    title?: string;
    content?: string;
    status?: PromptStatus;
    favorite?: boolean;
    tags?: string[];
    reason?: string;
  },
): PromptDetail | null {
  const current = getPrompt(id);
  if (!current) {
    return null;
  }
  const title = patch.title ?? current.title;
  const content = patch.content ?? current.content;
  const tags = patch.tags ?? current.tags;
  const status = patch.status ?? current.status;
  const favorite = patch.favorite ?? current.favorite;
  const reason = patch.reason ?? "Promptbar edit";
  const conn = db();
  const tx = conn.transaction(() => {
    if (content !== current.content || title !== current.title) {
      saveVersion(current, reason);
    }
    conn
      .prepare(
        `
        UPDATE documents SET
          title = @title,
          content = @content,
          content_hash = @hash,
          excerpt = @excerpt,
          tags_json = @tags,
          status = @status,
          favorite = @favorite,
          updated_at = @updatedAt
        WHERE id = @id
        `,
      )
      .run({
        id,
        title,
        content,
        hash: sha256(content),
        excerpt: excerpt(content),
        tags: JSON.stringify(tags),
        status,
        favorite: favorite ? 1 : 0,
        updatedAt: nowIso(),
      });
    replaceChunks(id, content);
    refreshFts(id);
  });
  tx();

  const updated = getPrompt(id);
  if (updated) {
    writeManagedFile(updated.corpusPath, {
      title: updated.title,
      content: updated.content,
      frontmatter: updated.frontmatter,
    });
  }
  return updated;
}

function saveVersion(current: PromptDetail, reason: string): void {
  db()
    .prepare(
      `
      INSERT INTO versions(
        id, document_id, title, content_hash, content, reason, created_at
      )
      VALUES(@id, @documentId, @title, @hash, @content, @reason, @createdAt)
      `,
    )
    .run({
      id: stableId(current.id, current.contentHash, nowIso()),
      documentId: current.id,
      title: current.title,
      hash: current.contentHash,
      content: current.content,
      reason,
      createdAt: nowIso(),
    });
}

function listVersions(documentId: string): PromptVersion[] {
  const rows = db()
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
  return rows;
}

function relatedPrompts(prompt: PromptSummary): PromptSummary[] {
  const tags = prompt.tags.slice(0, 3);
  if (!tags.length) {
    return [];
  }
  const rows = db()
    .prepare(
      `
      SELECT *, 0 AS score FROM documents
      WHERE id != ? AND (
        tags_json LIKE ? OR tags_json LIKE ? OR tags_json LIKE ?
      )
      ORDER BY updated_at DESC
      LIMIT 6
      `,
    )
    .all(
      prompt.id,
      `%"${tags[0] ?? ""}"%`,
      `%"${tags[1] ?? ""}"%`,
      `%"${tags[2] ?? ""}"%`,
    ) as Row[];
  return rows.map(summaryFromRow);
}

export function saveEvalRun(run: EvalRun): void {
  db()
    .prepare(
      `
      INSERT INTO eval_runs(id, created_at, mode, model, payload_json)
      VALUES(@id, @createdAt, @mode, @model, @payload)
      `,
    )
    .run({
      id: run.id,
      createdAt: run.createdAt,
      mode: run.mode,
      model: run.model,
      payload: JSON.stringify(run),
    });
}

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

export function candidateChunks(documentIds: string[]): ChunkRow[] {
  if (!documentIds.length) {
    return [];
  }
  const marks = documentIds.map(() => "?").join(",");
  return db()
    .prepare(
      `
      SELECT
        id,
        document_id AS documentId,
        content,
        content_hash AS contentHash,
        embedding,
        embedding_model AS embeddingModel,
        embedding_dim AS embeddingDim
      FROM chunks
      WHERE document_id IN (${marks})
      LIMIT 200
      `,
    )
    .all(...documentIds) as ChunkRow[];
}

export function storeEmbedding(input: {
  chunkId: string;
  model: string;
  vector: number[];
}): void {
  const array = new Float32Array(input.vector);
  db()
    .prepare(
      `
      UPDATE chunks SET
        embedding_model = @model,
        embedding_dim = @dim,
        embedding = @embedding
      WHERE id = @chunkId
      `,
    )
    .run({
      chunkId: input.chunkId,
      model: input.model,
      dim: array.length,
      embedding: Buffer.from(array.buffer),
    });
}

export function decodeEmbedding(buffer: Buffer): number[] {
  const view = new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  return Array.from(view);
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

function ftsQuery(value: string): string {
  const terms = value
    .split(/\s+/)
    .map((term) => term.replace(/["*]/g, "").trim())
    .filter((term) => term.length > 1)
    .slice(0, 12);
  return terms.map((term) => `"${term}"*`).join(" OR ") || '""';
}

export function currentEmbeddingModel(): string {
  return embeddingModel();
}
