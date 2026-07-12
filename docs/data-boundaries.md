# Data Boundaries

Promptbar is local-first. `promptops` owns authoritative prompt state and
Promptbar owns UI-local artifacts.

## Local State

- `promptops` stores private global state under `$PROMPTOPS_STATE_DIR` or
  `~/.local/state/promptops/`.
- The authoritative SQLite database is
  `~/.local/state/promptops/promptops.sqlite` by default.
- Codex hooks call `promptops capture hook` and write prompt events into that
  database.
- Promptbar reads promptops SQLite directly for fast views and calls
  `promptops --json` for imports, exports, search jobs, and prompt mutations.
- Exports are written to `.promptbar/exports/` and are redacted by default.
- `.promptbar/` is ignored and must not be tracked.

## Secrets

- `.env.example` is the only environment file intended for source control.
- `.env.local` and real API keys must stay untracked.
- AI code must read `PROMPTBAR_OPENAI_API_KEY` only.
- Do not read or fall back to global `OPENAI_API_KEY`.

## No-Key Mode

Without `PROMPTBAR_OPENAI_API_KEY`, Promptbar must still support lexical FTS
search, browsing, editing, exports, settings, local eval fallback, and explicit
Codex bridge status.

Promptops embeddings are opt-in. Hybrid search falls back to lexical results
unless `PROMPTOPS_EMBED_BASE_URL`, `PROMPTOPS_EMBED_MODEL`, and compatible
embedding settings are configured.

## Cited Refinement

- Refinement is opt-in and unavailable without `PROMPTBAR_OPENAI_API_KEY`.
- The model receives a numbered list containing only each selected prompt's
  title and redacted content, capped at 3,000 characters per prompt.
- Prompt IDs, source paths, corpus paths, raw content, frontmatter, and other
  local metadata are not included in the model request.
- The model returns source numbers. Promptbar validates them against the current
  selection and resolves citations to local prompt IDs and titles on the server.
- Generated Markdown and citations remain ephemeral UI state. They clear when
  the goal or selection changes, when another generation starts, or when the
  page reloads. Copying does not write to promptops, the editor, exports, or
  browser storage.

## Generated Artifacts

Do not track `.next/`, `.turbo/`, Playwright reports, screenshots, coverage,
TypeScript build info, `target/`, or generated local runtime artifacts.
