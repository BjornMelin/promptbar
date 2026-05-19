<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Promptbar Local Contract

- Keep private imported data under `.promptbar/`; never track it.
- Do not read global `OPENAI_API_KEY`. AI code must use
  `PROMPTBAR_OPENAI_API_KEY` only.
- Route handlers that touch SQLite, files, Codex, or subprocesses must export
  `runtime = "nodejs"`.
- Keep `better-sqlite3` and `@parcel/watcher` server-only.
- Prefer shadcn/Radix owned components, AI SDK v6 APIs, and AI Elements only
  for model-rendered text/tool output.
- The app should remain useful with no API key: FTS search, editor, exports,
  and local eval fallback must keep working.
