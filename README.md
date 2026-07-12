# Promptbar

**A local command center for prompt libraries.**

Promptbar turns scattered prompt folders into a fast, searchable workbench for
importing, normalizing, editing, evaluating, and exporting prompt corpora. It is
built for serious prompt maintenance: local state, explicit AI boundaries, quick
iteration, and reviewable exports back to the source repository.

## Why Promptbar

- **Bring order to prompt sprawl:** import an existing corpus, normalize it into
  managed local working data, and browse it through a focused workbench instead
  of raw folders.
- **Search and edit without cloud lock-in:** use local SQLite FTS, structured
  metadata, and a dense editor-first UI before bringing any model provider into
  the loop.
- **Share search options:** run **Search** or **Refresh**, then select **Copy
  link** to share the committed query and filters. Links include the query text,
  but not selections or editor state, so review the query before sharing.
- **Evaluate with guardrails:** run local fallback evals by default, then opt in
  to repo-scoped OpenAI features only when `PROMPTBAR_OPENAI_API_KEY` is set.
- **Export with confidence:** keep generated artifacts under `.promptbar/` and
  review exports before moving polished prompt changes upstream.

## Runtime Model

- `promptops` is the authoritative Rust data engine and CLI. It owns prompt
  capture, import, SQLite migrations, FTS search, hybrid search, overlays,
  exports, and Codex hook ingestion.
- Next.js App Router runs locally with Node runtime route handlers. Promptbar
  reads the promptops SQLite database directly for fast views and calls
  `promptops --json` for writes and jobs.
- SQLite state lives at `~/.local/state/promptops/promptops.sqlite` by default.
  Set `PROMPTOPS_STATE_DIR` to override it.
- Promptbar keeps only UI-local artifacts under `.promptbar/`, including
  reviewed exports.
- AI features only read `PROMPTBAR_OPENAI_API_KEY` from this repo's local
  environment. Global `OPENAI_API_KEY` is intentionally ignored.
- Without a repo-scoped key, Promptbar remains usable with local FTS search,
  editing, exports, local eval fallback, and explicit Codex bridge status.

## Bundled corpus

Promptbar ships six reusable engineering prompts curated from Prompt Atlas.
Import them through promptops’ canonical `canon/` lane:

```bash
bun run db:import "$PWD/corpus"
```

The root-level [provenance ledger](corpus/prompt-atlas-disposition.json) and
[MIT license notice](corpus/PROMPT_ATLAS_LICENSE) remain review records and do
not enter the prompt index.

## Commands

```bash
bun install
bun run promptops:install
bun run promptops:doctor
bun run db:import /home/bjorn/prompt_library
bun run dev
```

Open `http://127.0.0.1:3000`.

Verification:

```bash
bun run lint
bun run typecheck
bun run test
bun run build
bun run test:e2e
```

Turbo orchestration:

```bash
bunx turbo run lint typecheck test build
```

Vercel local dev:

```bash
bun run dev:vercel
```

Promptops CLI checks:

```bash
promptops doctor
promptops capture backfill --since-days 30
promptops search "promptops" --mode hybrid --limit 10
promptops policy manifest
```

Contributor release policy lives in [docs/release-policy.md](docs/release-policy.md).

## AI Configuration

Create `.env.local` from `.env.example`:

```bash
PROMPTBAR_OPENAI_API_KEY=sk-proj-...
PROMPTBAR_OPENAI_MODEL=gpt-5.4
PROMPTBAR_EMBEDDING_MODEL=text-embedding-3-small
# Optional: omit to use $HOME/prompt_library.
# PROMPTBAR_DEFAULT_IMPORT_ROOT=/absolute/path/to/prompt_library
```

Promptbar does not auto-read `OPENAI_API_KEY`; this avoids accidental spend
from global shell configuration.

## Data Boundaries

Raw prompt captures and the live prompt index are private global promptops
state. Exports are redacted by default and written to `.promptbar/exports/` for
review before moving content back to an upstream prompt repository.
