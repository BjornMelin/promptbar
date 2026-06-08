import path from "node:path";

export const appRoot = process.env.PROMPTBAR_APP_ROOT ?? ".";
const homeRoot = process.env.HOME ?? path.resolve(".");
export const stateDir = path.join(/*turbopackIgnore: true*/ appRoot, ".promptbar");
export const corpusDir = path.join(/*turbopackIgnore: true*/ stateDir, "corpus");
export const exportsDir = path.join(/*turbopackIgnore: true*/ stateDir, "exports");
export const versionsDir = path.join(/*turbopackIgnore: true*/ stateDir, "versions");
export const promptopsStateDir =
  process.env.PROMPTOPS_STATE_DIR ??
  path.join(
    /*turbopackIgnore: true*/ process.env.XDG_STATE_HOME ??
      path.join(/*turbopackIgnore: true*/ homeRoot, ".local/state"),
    "promptops",
  );
export const promptopsConfigDir =
  process.env.PROMPTOPS_CONFIG_DIR ??
  path.join(
    /*turbopackIgnore: true*/ process.env.XDG_CONFIG_HOME ??
      path.join(/*turbopackIgnore: true*/ homeRoot, ".config"),
    "promptops",
  );
export const promptopsCacheDir =
  process.env.PROMPTOPS_CACHE_DIR ??
  path.join(
    /*turbopackIgnore: true*/ process.env.XDG_CACHE_HOME ??
      path.join(/*turbopackIgnore: true*/ homeRoot, ".cache"),
    "promptops",
  );
export const databasePath = path.join(
  /*turbopackIgnore: true*/ promptopsStateDir,
  "promptops.sqlite",
);

/**
 * Returns the default prompt corpus import root.
 *
 * @returns The path from `PROMPTBAR_DEFAULT_IMPORT_ROOT` or `HOME/prompt_library`.
 */
export function defaultImportRoot(): string {
  return (
    process.env.PROMPTBAR_DEFAULT_IMPORT_ROOT ??
    path.join(/*turbopackIgnore: true*/ homeRoot, "prompt_library")
  );
}
