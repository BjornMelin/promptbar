# Use the bundled prompt corpus

Promptbar includes six canonical prompts curated from Prompt Atlas. The prompts focus on reusable engineering tasks and avoid unnecessary toolchain, package-manager, provider-specific, and hidden-reasoning requirements.

Import the corpus into an isolated or local promptops state:

```bash
bun run db:import "$PWD/corpus"
```

In this bundle, promptops imports the six Markdown files under `corpus/canon/` and skips the root-level provenance files.

## Review the source decisions

`prompt-atlas-disposition.json` records every asset in its declared content scope for the pinned Prompt Atlas snapshot. Each entry identifies the source Git blob and explains whether Promptbar curated, superseded, excluded, or retained it only for provenance.

The curated prompts derive from [`BjornMelin/prompt-atlas`](https://github.com/BjornMelin/prompt-atlas) at the revision recorded in the disposition ledger. Prompt Atlas is Copyright (c) 2024 Bjorn Melin and licensed under the MIT License. See `PROMPT_ATLAS_LICENSE` for the required notice.

## Add or change a prompt

Keep each canonical file atomic and useful without a specific toolchain. Give it one action-oriented title, required inputs, ordered instructions, an output contract, and testable acceptance criteria.

When a curated file changes, update its `destinationSha256` in `prompt-atlas-disposition.json`. If the source snapshot changes, reconcile the complete source inventory before changing the pinned commit or asset count.
