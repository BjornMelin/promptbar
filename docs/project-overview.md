# Project Overview

Promptbar is a local-first Next.js prompt workbench for importing, searching,
editing, evaluating, and exporting prompt corpora.

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
- `src/lib/server` contains server-only filesystem, SQLite, AI, import, and
  Codex bridge code.
- `src/lib/shared` contains shared schemas, types, and tests.
- `tests/e2e` contains Playwright coverage for browser behavior.

## Runtime Shape

Promptbar runs locally, stores managed runtime state under `.promptbar/`, and
keeps AI features scoped to `PROMPTBAR_OPENAI_API_KEY` so global OpenAI shell
configuration is not used accidentally.
