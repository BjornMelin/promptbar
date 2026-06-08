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

export async function importCorpus(root: string): Promise<ImportReport> {
  const envelope = runPromptopsJson<PromptopsImportReport>(["import", root]);
  return {
    root: envelope.data.root,
    imported: envelope.data.imported,
    skipped: envelope.data.skipped,
    rawRecords: envelope.data.raw_records,
    files: envelope.data.files,
    at: envelope.data.at,
  };
}
