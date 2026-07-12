# Project Overview

Promptbar is a local-first prompt workbench backed by `promptops`, a Rust
CLI/data engine for prompt capture, indexing, search, editing overlays, and
exports.

## Documentation Map

- `README.md` is the user-facing setup, runtime model, command, and data
  boundary entrypoint.
- `docs/development-guide.md` covers contributor setup, verification, and source
  ownership.
- `docs/data-boundaries.md` covers local state, secrets, generated artifacts,
  and export behavior.
- `docs/release-policy.md` covers Conventional Commits, Release Please, SemVer,
  changelog, tag, and GitHub Release behavior.
- `AGENTS.md` is the durable agent contract for repo invariants and expected
  automation behavior.
- `.github/pull_request_template.md` is the reviewer-facing pull request body
  contract.

## Source Map

- `src/app` contains the App Router pages and API route handlers.
- `src/components/workbench` contains the primary Promptbar workbench UI.
- `src/components/ui` contains shadcn/Radix-owned UI primitives.
- `crates/` contains the promptops Rust core and CLI.
- `corpus/` contains the bundled canonical prompts, source disposition ledger,
  and upstream license notice.
- `src/lib/server` contains server-only Promptbar adapters for promptops,
  SQLite reads, AI, and Codex bridge code.
- `src/lib/shared` contains shared schemas, types, and tests.
- `tests/e2e` contains Playwright coverage for browser behavior.

## Runtime Shape

Promptbar runs locally. Promptops stores authoritative private state under
`$PROMPTOPS_STATE_DIR` or `~/.local/state/promptops/`, while Promptbar keeps
UI-local artifacts under `.promptbar/`. AI features stay scoped to
`PROMPTBAR_OPENAI_API_KEY` so global OpenAI shell configuration is not used
accidentally.
