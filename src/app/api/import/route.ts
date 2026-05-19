import { NextResponse } from "next/server";

import { importCorpus } from "@/lib/server/import-corpus";
import { defaultImportRoot } from "@/lib/server/paths";
import { importRequestSchema } from "@/lib/shared/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = importRequestSchema.parse(
    await request.json().catch(() => ({})),
  );
  const report = await importCorpus(body.root ?? defaultImportRoot());
  return NextResponse.json({ report });
}
