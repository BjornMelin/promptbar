# Promptbar

Promptbar is a local-first prompt workbench for importing, normalizing,
searching, editing, evaluating, and exporting prompt corpora.

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

## AI Configuration

Create `.env.local` from `.env.example`:

```bash
PROMPTBAR_OPENAI_API_KEY=sk-proj-...
PROMPTBAR_OPENAI_MODEL=gpt-5.4
PROMPTBAR_EMBEDDING_MODEL=text-embedding-3-small
PROMPTBAR_DEFAULT_IMPORT_ROOT=/home/bjorn/prompt_library
```

Promptbar does not auto-read `OPENAI_API_KEY`; this avoids accidental spend
from global shell configuration.

## Data Boundaries

The app treats imported prompts as managed local working data. Exports are
written to `.promptbar/exports/` and can be reviewed before moving content back
to an upstream prompt repository.
