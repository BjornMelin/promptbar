import { NextResponse } from "next/server";

import { apiEnabled, codexAvailable } from "../../../lib/server/env";
import { runPromptopsJson } from "../../../lib/server/promptops";
import { searchRequestSchema } from "../../../lib/shared/schemas";
import type {
  PromptKind,
  PromptStatus,
  SearchMode,
  SearchResponse,
} from "../../../lib/shared/types";

export const runtime = "nodejs";

type PromptopsSearchResponse = {
  mode: SearchMode;
  query: string;
  results: Array<{
    id: string;
    title: string;
    kind: string;
    status: string;
    favorite: boolean;
    tags: string[];
    risk_flags: string[];
    source_path: string;
    corpus_path: string;
    excerpt: string;
    content_hash: string;
    updated_at: string;
    score: number;
    semantic_score: number | null;
  }>;
  facets: SearchResponse["facets"];
  stats: {
    documents: number;
    chunks: number;
    favorites: number;
    risks: number;
    eval_runs: number;
    embedded_chunks: number;
    latest_import_at: string | null;
    default_import_root: string;
  };
  hybrid_available: boolean;
  hybrid_reason: string;
};

/**
 * Searches prompt documents through the canonical promptops engine.
 *
 * @param request - Incoming HTTP request containing search query parameters.
 * @returns A JSON search response with results, facets, stats, and mode metadata.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = searchRequestSchema.parse(
    Object.fromEntries(url.searchParams.entries()),
  );
  const args = ["search", `--mode=${parsed.mode}`, `--limit=${parsed.limit}`];
  if (parsed.kind) args.push(`--kind=${parsed.kind}`);
  if (parsed.status) args.push(`--status=${parsed.status}`);
  if (parsed.tag) args.push(`--tag=${parsed.tag}`);
  args.push("--", parsed.q);

  const envelope = await runPromptopsJson<PromptopsSearchResponse>(args);
  return NextResponse.json(adaptSearchResponse(envelope.data));
}

function adaptSearchResponse(data: PromptopsSearchResponse): SearchResponse {
  return {
    mode: data.mode,
    query: data.query,
    results: data.results.map((item) => ({
      id: item.id,
      title: item.title,
      kind: item.kind as PromptKind,
      status: item.status as PromptStatus,
      favorite: item.favorite,
      tags: item.tags,
      riskFlags: item.risk_flags,
      sourcePath: item.source_path,
      corpusPath: item.corpus_path,
      excerpt: item.excerpt,
      contentHash: item.content_hash,
      updatedAt: item.updated_at,
      score: item.score,
      semanticScore: item.semantic_score,
    })),
    facets: data.facets,
    stats: {
      documents: data.stats.documents,
      chunks: data.stats.chunks,
      favorites: data.stats.favorites,
      risks: data.stats.risks,
      evalRuns: data.stats.eval_runs,
      embeddedChunks: data.stats.embedded_chunks,
      latestImportAt: data.stats.latest_import_at,
      apiEnabled: apiEnabled(),
      codexAvailable: codexAvailable(),
      defaultImportRoot: data.stats.default_import_root,
    },
    hybridAvailable: data.hybrid_available,
    hybridReason: data.hybrid_reason,
  };
}
