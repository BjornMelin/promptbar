import path from "node:path";

export const appRoot = process.env.PROMPTBAR_APP_ROOT ?? ".";
export const stateDir = path.join(/*turbopackIgnore: true*/ appRoot, ".promptbar");
export const corpusDir = path.join(/*turbopackIgnore: true*/ stateDir, "corpus");
export const exportsDir = path.join(/*turbopackIgnore: true*/ stateDir, "exports");
export const versionsDir = path.join(/*turbopackIgnore: true*/ stateDir, "versions");
export const promptopsStateDir =
  process.env.PROMPTOPS_STATE_DIR ??
  path.join(
    /*turbopackIgnore: true*/ process.env.XDG_STATE_HOME ??
      path.join(/*turbopackIgnore: true*/ process.env.HOME ?? ".", ".local/state"),
    "promptops",
  );
export const promptopsConfigDir =
  process.env.PROMPTOPS_CONFIG_DIR ??
  path.join(
    /*turbopackIgnore: true*/ process.env.XDG_CONFIG_HOME ??
      path.join(/*turbopackIgnore: true*/ process.env.HOME ?? ".", ".config"),
    "promptops",
  );
export const promptopsCacheDir =
  process.env.PROMPTOPS_CACHE_DIR ??
  path.join(
    /*turbopackIgnore: true*/ process.env.XDG_CACHE_HOME ??
      path.join(/*turbopackIgnore: true*/ process.env.HOME ?? ".", ".cache"),
    "promptops",
  );
export const databasePath = path.join(
  /*turbopackIgnore: true*/ promptopsStateDir,
  "promptops.sqlite",
);

export function defaultImportRoot(): string {
  return (
    process.env.PROMPTBAR_DEFAULT_IMPORT_ROOT ??
    path.join(/*turbopackIgnore: true*/ process.env.HOME ?? ".", "prompt_library")
  );
}
