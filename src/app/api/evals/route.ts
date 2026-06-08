import { NextResponse } from "next/server";

import { runEvalCase } from "@/lib/server/ai";
import {
  ensurePromptopsStateReady,
  getPromptContent,
  recentEvalRuns,
  saveEvalRun,
} from "@/lib/server/db";
import { openAiModel, repoOpenAiKey } from "@/lib/server/env";
import { nowIso, stableId } from "@/lib/server/crypto";
import { evalRunRequestSchema } from "@/lib/shared/schemas";
import type { EvalRun } from "@/lib/shared/types";

export const runtime = "nodejs";

export async function GET() {
  await ensurePromptopsStateReady();
  return NextResponse.json({ runs: recentEvalRuns(20) });
}

export async function POST(request: Request) {
  await ensurePromptopsStateReady();
  const body = evalRunRequestSchema.parse(await request.json());
  const prompts = getPromptContent(body.promptIds);
  const results = [];
  for (const prompt of prompts) {
    for (const testCase of body.cases) {
      results.push(await runEvalCase({ prompt, testCase }));
    }
  }
  const run: EvalRun = {
    id: stableId(nowIso(), body.promptIds.join(",")),
    createdAt: nowIso(),
    mode: repoOpenAiKey() ? "api" : "local",
    model: repoOpenAiKey() ? openAiModel() : "local-fallback",
    promptIds: body.promptIds,
    cases: body.cases,
    results,
  };
  await saveEvalRun(run);
  return NextResponse.json({ run });
}
