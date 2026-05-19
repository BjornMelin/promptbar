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
- **Evaluate with guardrails:** run local fallback evals by default, then opt in
  to repo-scoped OpenAI features only when `PROMPTBAR_OPENAI_API_KEY` is set.
- **Export with confidence:** keep generated artifacts under `.promptbar/` and
  review exports before moving polished prompt changes upstream.

## Runtime Model

- Next.js App Router runs locally with Node runtime route handlers.
- Prompt data is imported into `.promptbar/corpus/`, which is gitignored.
- SQLite state lives at `.promptbar/promptbar.sqlite`.
- AI features only read `PROMPTBAR_OPENAI_API_KEY` from this repo's local
  environment. Global `OPENAI_API_KEY` is intentionally ignored.
- Without a repo-scoped key, Promptbar remains usable with local FTS search,
  editing, exports, local eval fallback, and explicit Codex bridge status.

## Commands

```bash
bun install
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

The app treats imported prompts as managed local working data. Exports are
written to `.promptbar/exports/` and can be reviewed before moving content back
to an upstream prompt repository.
