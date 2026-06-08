import { NextResponse } from "next/server";

import {
  ensurePromptopsStateReady,
  facets,
  searchDocuments,
  stats,
} from "@/lib/server/db";
import { runPromptopsJson } from "@/lib/server/promptops";
import { searchRequestSchema } from "@/lib/shared/schemas";
import type { SearchResponse } from "@/lib/shared/types";

export const runtime = "nodejs";

/**
 * Searches prompt documents with lexical or hybrid promptops search.
 *
 * @param request - Incoming HTTP request containing search query parameters.
 * @returns A JSON search response with results, facets, stats, and mode metadata.
 */
export async function GET(request: Request) {
  await ensurePromptopsStateReady();
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());
  const parsed = searchRequestSchema.parse(query);
  const base = {
    query: parsed.q,
    kind: parsed.kind,
    status: parsed.status,
    tag: parsed.tag,
    limit: parsed.limit,
  };
  if (parsed.mode === "hybrid") {
    const args = ["search", parsed.q, "--mode", "hybrid", "--limit", String(parsed.limit)];
    if (parsed.kind) args.push("--kind", parsed.kind);
    if (parsed.status) args.push("--status", parsed.status);
    if (parsed.tag) args.push("--tag", parsed.tag);
    const envelope = await runPromptopsJson<{
      mode: "Lexical" | "Hybrid" | "lexical" | "hybrid";
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
        score?: number;
        semantic_score?: number;
      }>;
      hybrid_available: boolean;
      hybrid_reason: string;
    }>(args);
    const mode =
      envelope.data.mode.toLowerCase() === "hybrid" ? "hybrid" : "lexical";
    const payload: SearchResponse = {
      mode,
      query: envelope.data.query,
      results: envelope.data.results.map((item) => ({
        id: item.id,
        title: item.title,
        kind: item.kind as never,
        status: item.status as never,
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
      facets: facets(),
      stats: stats(),
      hybridAvailable: envelope.data.hybrid_available,
      hybridReason: envelope.data.hybrid_reason,
    };
    return NextResponse.json(payload);
  }
  const result = {
    results: searchDocuments({
      ...base,
      mode: "lexical",
    }),
    available: false,
    reason: "Lexical FTS5 search is active.",
  };
  const payload: SearchResponse = {
    mode: parsed.mode,
    query: parsed.q,
    results: result.results,
    facets: facets(),
    stats: stats(),
    hybridAvailable: result.available,
    hybridReason: result.reason,
  };
  return NextResponse.json(payload);
}
