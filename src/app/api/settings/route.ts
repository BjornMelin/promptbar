import { NextResponse } from "next/server";

import {
  apiEnabled,
  codexAvailable,
  embeddingModel,
  openAiModel,
} from "@/lib/server/env";
import { corpusDir, databasePath } from "@/lib/server/paths";
import type { AppSettings } from "@/lib/shared/types";

export const runtime = "nodejs";

export async function GET() {
  const settings: AppSettings = {
    apiEnabled: apiEnabled(),
    apiKeyEnv: "PROMPTBAR_OPENAI_API_KEY",
    model: openAiModel(),
    embeddingModel: embeddingModel(),
    dbPath: databasePath,
    corpusDir,
    codexAvailable: codexAvailable(),
  };
  return NextResponse.json(settings);
}
