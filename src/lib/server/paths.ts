import path from "node:path";

/**
 * Root directory used for Promptbar-local runtime artifacts.
 */
export const appRoot = process.env.PROMPTBAR_APP_ROOT ?? ".";
const homeRoot = process.env.HOME ?? path.resolve(".");
/**
 * Promptbar-local state directory for UI-owned artifacts.
 */
export const stateDir = path.join(/*turbopackIgnore: true*/ appRoot, ".promptbar");
/**
 * Promptbar-local corpus staging directory.
 */
export const corpusDir = path.join(/*turbopackIgnore: true*/ stateDir, "corpus");
/**
 * Promptbar-local export output directory.
 */
export const exportsDir = path.join(/*turbopackIgnore: true*/ stateDir, "exports");
/**
 * Promptbar-local prompt version artifact directory.
 */
export const versionsDir = path.join(/*turbopackIgnore: true*/ stateDir, "versions");
/**
 * promptops state root containing the authoritative SQLite database.
 */
export const promptopsStateDir =
  process.env.PROMPTOPS_STATE_DIR ??
  path.join(
    /*turbopackIgnore: true*/ process.env.XDG_STATE_HOME ??
      path.join(/*turbopackIgnore: true*/ homeRoot, ".local/state"),
    "promptops",
  );
/**
 * promptops config root for local policy and configuration files.
 */
export const promptopsConfigDir =
  process.env.PROMPTOPS_CONFIG_DIR ??
  path.join(
    /*turbopackIgnore: true*/ process.env.XDG_CONFIG_HOME ??
      path.join(/*turbopackIgnore: true*/ homeRoot, ".config"),
    "promptops",
  );
/**
 * promptops cache root for generated or reusable local cache files.
 */
export const promptopsCacheDir =
  process.env.PROMPTOPS_CACHE_DIR ??
  path.join(
    /*turbopackIgnore: true*/ process.env.XDG_CACHE_HOME ??
      path.join(/*turbopackIgnore: true*/ homeRoot, ".cache"),
    "promptops",
  );
/**
 * Absolute path to the promptops SQLite database used by Promptbar reads.
 */
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
