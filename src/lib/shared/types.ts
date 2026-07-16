import type { z } from "zod";

import type {
  promptStatusSchema,
  refinementRequestSchema,
  refinementResponseSchema,
  searchModeSchema,
} from "./schemas";

export type PromptKind =
  | "codex-raw"
  | "canon"
  | "reference"
  | "project"
  | "archive"
  | "manifest"
  | "imported";

/** Enumerates lifecycle states accepted by prompt records and filters. */
export type PromptStatus = z.infer<typeof promptStatusSchema>;

export type AiMode = "local" | "api" | "codex";

/** Enumerates the supported lexical and embedding-assisted search modes. */
export type SearchMode = z.infer<typeof searchModeSchema>;

/** Request accepted by the cited prompt-refinement endpoint. */
export type RefinementRequest = z.infer<typeof refinementRequestSchema>;

/** Generated prompt markdown with citations resolved to Promptbar records. */
export type RefinementResponse = z.infer<typeof refinementResponseSchema>;

export type PromptSummary = {
  id: string;
  title: string;
  kind: PromptKind;
  status: PromptStatus;
  favorite: boolean;
  tags: string[];
  riskFlags: string[];
  sourcePath: string;
  corpusPath: string;
  excerpt: string;
  contentHash: string;
  updatedAt: string;
  score?: number;
  semanticScore?: number | null;
};

/**
 * Full prompt record for editor, reveal, version, and related-prompt views.
 */
export type PromptDetail = PromptSummary & {
  content: string;
  rawContent?: string;
  redactedContent?: string;
  frontmatter: Record<string, unknown>;
  versions: PromptVersion[];
  related: PromptSummary[];
};

export type PromptVersion = {
  id: string;
  documentId: string;
  createdAt: string;
  title: string;
  contentHash: string;
  content: string;
  reason: string;
};

export type CorpusStats = {
  documents: number;
  chunks: number;
  favorites: number;
  risks: number;
  evalRuns: number;
  embeddedChunks: number;
  latestImportAt: string | null;
  apiEnabled: boolean;
  codexAvailable: boolean;
  defaultImportRoot: string;
};

export type FacetValue = {
  value: string;
  count: number;
};

export type Facets = {
  kinds: FacetValue[];
  statuses: FacetValue[];
  tags: FacetValue[];
  risks: FacetValue[];
};

export type SearchResponse = {
  mode: SearchMode;
  query: string;
  results: PromptSummary[];
  facets: Facets;
  stats: CorpusStats;
  hybridAvailable: boolean;
  hybridReason: string;
};

export type ImportReport = {
  root: string;
  imported: number;
  skipped: number;
  rawRecords: number;
  files: number;
  at: string;
};

export type EvalCase = {
  id: string;
  name: string;
  input: string;
  assertions: string[];
};

export type EvalRun = {
  id: string;
  createdAt: string;
  mode: AiMode;
  model: string;
  promptIds: string[];
  cases: EvalCase[];
  results: EvalResult[];
};

export type EvalResult = {
  promptId: string;
  caseId: string;
  output: string;
  passed: number;
  failed: number;
  notes: string;
  durationMs: number;
};

/**
 * Runtime settings surfaced to the workbench settings panel.
 */
export type AppSettings = {
  apiEnabled: boolean;
  apiKeyEnv: "PROMPTBAR_OPENAI_API_KEY";
  model: string;
  embeddingModel: string;
  dbPath: string;
  corpusDir: string;
  promptopsStateDir?: string;
  codexAvailable: boolean;
};
