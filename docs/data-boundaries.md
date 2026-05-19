# Data Boundaries

Promptbar is local-first. Imported prompts, SQLite state, managed files, and
exports stay under `.promptbar/`.

## Local State

- Imported prompt files are managed under `.promptbar/corpus/`.
- SQLite state lives at `.promptbar/promptbar.sqlite`.
- Exports are written to `.promptbar/exports/`.
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

## Generated Artifacts

Do not track `.next/`, `.turbo/`, Playwright reports, screenshots, coverage,
TypeScript build info, or generated local runtime artifacts.
