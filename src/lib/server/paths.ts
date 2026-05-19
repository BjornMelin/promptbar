import path from "node:path";

export const appRoot = process.cwd();
export const stateDir = path.join(appRoot, ".promptbar");
export const corpusDir = path.join(stateDir, "corpus");
export const exportsDir = path.join(stateDir, "exports");
export const versionsDir = path.join(stateDir, "versions");
export const databasePath = path.join(stateDir, "promptbar.sqlite");

export function defaultImportRoot(): string {
  return (
    process.env.PROMPTBAR_DEFAULT_IMPORT_ROOT ??
    path.join(process.env.HOME ?? appRoot, "prompt_library")
  );
}
