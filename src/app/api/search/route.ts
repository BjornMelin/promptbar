import { NextResponse } from "next/server";

import { facets, searchDocuments, stats } from "@/lib/server/db";
import { hybridSearch } from "@/lib/server/ai";
import { searchRequestSchema } from "@/lib/shared/schemas";
import type { SearchResponse } from "@/lib/shared/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
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
  const result =
    parsed.mode === "hybrid"
      ? await hybridSearch(base)
      : {
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
