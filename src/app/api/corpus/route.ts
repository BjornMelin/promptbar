import { NextResponse } from "next/server";

import {
  allSearchableDocuments,
  ensurePromptopsStateReady,
  facets,
  recentEvalRuns,
  stats,
} from "@/lib/server/db";

export const runtime = "nodejs";

export async function GET() {
  await ensurePromptopsStateReady();
  return NextResponse.json({
    stats: stats(),
    facets: facets(),
    recent: allSearchableDocuments(24),
    evalRuns: recentEvalRuns(6),
  });
}
