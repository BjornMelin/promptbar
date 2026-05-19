import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("inbox"),
  favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
  tagsJson: text("tags_json").notNull().default("[]"),
  riskFlagsJson: text("risk_flags_json").notNull().default("[]"),
  sourcePath: text("source_path").notNull(),
  corpusPath: text("corpus_path").notNull(),
  contentHash: text("content_hash").notNull(),
  content: text("content").notNull(),
  excerpt: text("excerpt").notNull(),
  frontmatterJson: text("frontmatter_json").notNull().default("{}"),
  importedAt: text("imported_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const chunks = sqliteTable("chunks", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  content: text("content").notNull(),
  contentHash: text("content_hash").notNull(),
  tokenEstimate: integer("token_estimate").notNull(),
  embeddingModel: text("embedding_model"),
  embeddingDim: integer("embedding_dim"),
  embedding: text("embedding", { mode: "json" }),
});

export const versions = sqliteTable("versions", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  title: text("title").notNull(),
  contentHash: text("content_hash").notNull(),
  content: text("content").notNull(),
  reason: text("reason").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const evalRuns = sqliteTable("eval_runs", {
  id: text("id").primaryKey(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  mode: text("mode").notNull(),
  model: text("model").notNull(),
  payloadJson: text("payload_json").notNull(),
});
