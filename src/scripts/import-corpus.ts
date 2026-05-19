import { importCorpus } from "@/lib/server/import-corpus";
import { defaultImportRoot } from "@/lib/server/paths";

async function main(): Promise<void> {
  const root = process.argv[2] ?? defaultImportRoot();
  const report = await importCorpus(root);
  console.log(JSON.stringify(report, null, 2));
}

void main();
