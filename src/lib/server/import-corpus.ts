import "server-only";

import { runPromptopsJson } from "@/lib/server/promptops";
import type { ImportReport } from "@/lib/shared/types";

type PromptopsImportReport = {
  root: string;
  imported: number;
  skipped: number;
  raw_records: number;
  files: number;
  at: string;
};

/**
 * Imports a prompt corpus through promptops and adapts the report shape.
 *
 * @param root - Filesystem root to import as a prompt corpus.
 * @returns Import summary including root, counts, file total, and timestamp.
 */
export async function importCorpus(root: string): Promise<ImportReport> {
  const envelope = await runPromptopsJson<PromptopsImportReport>([
    "import",
    root,
  ]);
  return {
    root: envelope.data.root,
    imported: envelope.data.imported,
    skipped: envelope.data.skipped,
    rawRecords: envelope.data.raw_records,
    files: envelope.data.files,
    at: envelope.data.at,
  };
}
