import { NextResponse } from "next/server";

import {
  apiEnabled,
  codexAvailable,
  embeddingModel,
  openAiModel,
} from "@/lib/server/env";
import {
  databasePath,
  defaultImportRoot,
  promptopsStateDir,
} from "@/lib/server/paths";
import type { AppSettings } from "@/lib/shared/types";

export const runtime = "nodejs";

/**
 * Returns current Promptbar runtime settings.
 *
 * @returns JSON `AppSettings` with API, model, storage, and Codex status.
 */
export async function GET() {
  const settings: AppSettings = {
    apiEnabled: apiEnabled(),
    apiKeyEnv: "PROMPTBAR_OPENAI_API_KEY",
    model: openAiModel(),
    embeddingModel: embeddingModel(),
    dbPath: databasePath,
    corpusDir: defaultImportRoot(),
    promptopsStateDir,
    codexAvailable: codexAvailable(),
  };
  return NextResponse.json(settings);
}
