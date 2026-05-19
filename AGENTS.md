# AGENTS.md - Promptbar

Promptbar is a local-first Next.js prompt workbench for importing, searching,
editing, evaluating, and exporting prompt corpora. This file is the canonical
agent contract for the repo; do not add tool-specific mirror files such as
`CLAUDE.md`.

## Next.js 16 Contract

- This is Next.js 16.2.6 with App Router, React 19, React Compiler, and
  Turbopack settings. Do not rely on older Next.js conventions from memory.
- Before changing Next.js routing, route handlers, server/client components,
  metadata, caching, or bundling, read the relevant guide in
  `node_modules/next/dist/docs/`.
- Keep API route handlers in `src/app/api/**/route.ts`. A route handler cannot
  share the same route segment level with a page file.
- Route handlers that touch SQLite, files, Codex, subprocesses, or server-only
  packages must export `runtime = "nodejs"`.

## Package And Commands

- Use Bun as the package manager. The repo declares `packageManager:
  bun@1.3.14`; do not introduce npm, pnpm, or yarn lockfiles.
- Common commands:
  - `bun install`
  - `bun run dev`
  - `bun run db:import /home/bjorn/prompt_library`
  - `bun run lint`
  - `bun run typecheck`
  - `bun run test`
  - `bun run build`
  - `bun run test:e2e`
- For broad verification, prefer `bun run verify` for lint, typecheck, unit
  tests, and build. Run `bun run test:e2e` when UI behavior or routing changes.
- Do not run write-mode formatters unless the task is explicitly formatting or
  you are about to commit formatter output intentionally.

## Data And Secrets

- Keep all imported prompt data, SQLite state, managed corpus files, exports,
  and local runtime artifacts under `.promptbar/`; never track that directory.
- Do not track `.env.local`, real API keys, generated Playwright reports,
  screenshots, coverage, `.next/`, `.turbo/`, or TypeScript build info.
- `.env.example` is the only env file intended for source control.
- AI code must read `PROMPTBAR_OPENAI_API_KEY` only. Never read or fall back to
  global `OPENAI_API_KEY`.
- The app must remain useful without an API key: lexical FTS search, browsing,
  editing, exports, settings, and local eval fallback must keep working.

## Architecture Boundaries

- Server-only code lives in `src/lib/server`. Do not import it into client
  components. Client code should go through API routes and shared types/schemas.
- Shared request schemas and public data shapes live in `src/lib/shared`.
  Update Zod schemas, TypeScript types, and tests together when changing an API
  contract.
- `src/lib/server/db.ts` owns the live SQLite initialization and migrations.
  `src/lib/server/schema.ts` is the Drizzle schema surface. Keep them aligned
  for table or column changes.
- `src/lib/server/paths.ts` owns local state paths. Do not duplicate `.promptbar`
  paths across unrelated modules.
- `src/lib/server/import-corpus.ts` owns import discovery, normalization,
  tagging, risk flags, and managed corpus writes.
- `src/lib/server/ai.ts` owns OpenAI provider creation, hybrid reranking, chat,
  and eval execution. Preserve local fallbacks when API generation is disabled.
- `src/lib/server/codex.ts` owns the explicit Codex bridge. Keep bridge calls
  bounded, local, and read-only unless the user task explicitly asks for edits.
- Keep `better-sqlite3`, `@parcel/watcher`, filesystem, child-process, and
  other Node-only dependencies server-side. Preserve `serverExternalPackages`
  in `next.config.ts` when those dependencies are used.

## UI Guidelines

- The primary UI is the workbench in `src/components/workbench/promptbar-app.tsx`.
  Keep the first screen functional, not a marketing landing page.
- Use existing shadcn/Radix-owned components from `src/components/ui` before
  adding new primitives.
- Use AI Elements components only for model-rendered text, code, tool, or
  conversation output.
- Keep CodeMirror editor behavior in `src/components/workbench/code-editor.tsx`.
- Preserve the current dense, local-tool layout: dashboard, search, editor,
  AI/Codex bridge, evals, command palette, and settings.
- Use `lucide-react` icons for icon buttons when an icon exists.
- Avoid UI text that explains the app's internal implementation or keyboard
  shortcuts unless it is necessary for a control label or accessibility.

## Testing Expectations

- Run the narrowest relevant check first, then broaden before final handoff.
- For API/schema changes, run `bun run test` and `bun run typecheck`.
- For UI or route changes, run `bun run lint`, `bun run typecheck`, and
  `bun run test:e2e`.
- For dependency, Next config, build, or server/runtime changes, run
  `bun run build`.
- Keep Playwright tests in `tests/e2e`; they should use the configured
  `127.0.0.1:3000` base URL and the built-in web server from
  `playwright.config.ts`.

## Pull Request And Release Versioning

- Pull request titles and squash merge commits should use Conventional Commits:
  `<type>(<optional-scope>): <concise imperative summary>`.
- Use common types such as `feat`, `fix`, `refactor`, `perf`, `docs`, `test`,
  `build`, `ci`, `chore`, and `revert`.
- Promptbar is on a pre-1.0 SemVer track managed by Release Please:
  `fix:` bumps patch, `feat:` bumps patch, and `!` or `BREAKING CHANGE:`
  bumps minor.
- Mark breaking changes honestly with `!` or a `BREAKING CHANGE:` footer. Do
  not use `release-as` unless the user explicitly asks for a one-off override.
- Release Please owns `package.json` version updates,
  `.release-please-manifest.json`, `CHANGELOG.md`, GitHub Releases, and
  `vX.Y.Z` tags after merges to `main`.
- Do not rewrite Release Please generated release-note headings in release PR
  bodies or changelog entries; keep the generated version heading parseable.

## Documentation Rules

- Keep `README.md` focused on user setup, runtime model, commands, and data
  boundaries.
- Keep `AGENTS.md` focused on durable agent guidance only: repo invariants,
  architecture boundaries, and verification expectations.
- Do not put task logs, branch notes, temporary plans, or release narration in
  `AGENTS.md`.
- When changing durable behavior, update the canonical doc surface in the same
  change and remove stale guidance instead of adding duplicate notes.
