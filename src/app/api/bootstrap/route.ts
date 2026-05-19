import { NextResponse } from "next/server";

import { documentCount, facets, stats } from "@/lib/server/db";
import { importCorpus } from "@/lib/server/import-corpus";
import { defaultImportRoot } from "@/lib/server/paths";

export const runtime = "nodejs";

export async function GET() {
  let report = null;
  if (documentCount() === 0) {
    report = await importCorpus(defaultImportRoot());
  }
  return NextResponse.json({
    stats: stats(),
    facets: facets(),
    importReport: report,
  });
}
