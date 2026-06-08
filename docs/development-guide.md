# Development Guide

## Package Manager

Use Bun. The repo declares `packageManager: bun@1.3.14`; do not add npm, pnpm,
or yarn lockfiles.

## Setup

```bash
bun install
bun run promptops:install
bun run promptops:doctor
bun run db:import /home/bjorn/prompt_library
bun run dev
```

Promptbar uses the installed `promptops` binary by default. Set
`PROMPTOPS_BIN=/absolute/path/to/promptops` to override it, or
`PROMPTOPS_USE_CARGO=1` for source-tree development through `cargo run`.

Open `http://127.0.0.1:3000`.

## Verification

Run the narrowest relevant check first, then broaden before handoff.

```bash
bun run lint
bun run typecheck
bun run test
bun run build
bun run test:e2e
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --all-targets --all-features --locked
```

For broad validation, use:

```bash
bun run verify
```

## Source Ownership

- Rust promptops code lives under `crates/` and owns SQLite schema,
  migrations, prompt capture, import, search, overlays, export, embeddings,
  and CLI policy output.
- Keep API route handlers in `src/app/api/**/route.ts`.
- Route handlers that touch SQLite, files, Codex, subprocesses, or server-only
  packages must export `runtime = "nodejs"`.
- Server-only code belongs in `src/lib/server`.
- Shared request schemas and public data shapes belong in `src/lib/shared`.
- `src/lib/server/promptops.ts` owns calls to the promptops CLI.
- `src/lib/server/db.ts` is the Promptbar adapter over promptops state, not a
  second schema owner.
- `src/lib/server/import-corpus.ts` adapts API import requests to
  `promptops import`.
- The primary workbench UI lives in
  `src/components/workbench/promptbar-app.tsx`.
- CodeMirror editor behavior lives in
  `src/components/workbench/code-editor.tsx`.

## Documentation Changes

- Keep README user-focused.
- Put contributor and release policy in `docs/`.
- Keep temporary task logs, branch notes, and release narration out of
  `AGENTS.md`.
- When durable behavior changes, update the canonical doc surface in the same
  change and remove stale guidance.
