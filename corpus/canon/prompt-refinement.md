# Refine a reusable prompt

Convert a task and its constraints into a concise, self-contained prompt with a testable output contract.

## Required inputs

- `task_goal`: the outcome the prompt must produce
- `context_and_sources`: facts, examples, files, or references the executor may use
- `constraints_and_non_goals`: safety, scope, compatibility, and excluded work
- `tools_and_permissions`: available capabilities and allowed side effects
- `expected_output`: required artifact and response structure
- `acceptance_criteria`: observable conditions that define completion

## Instructions

1. Identify contradictions and missing information that would materially change the result.
2. Ask only blocking questions. Otherwise state low-risk assumptions and proceed.
3. Write direct instructions in execution order.
4. Define the available context, tools, permissions, uncertainty handling, and trust boundaries.
5. Require explicit decisions, concise rationale, and evidence only when the task depends on them. Do not request private chain-of-thought.
6. Specify the output structure and observable acceptance criteria.
7. Remove personas, duplicated framing, promotional claims, hidden-reasoning requests, and unsupported guarantees.
8. Remove fixed tools, dependencies, and version assumptions unless the inputs require them.
9. Return one copy-ready prompt and no alternate variants unless requested.

## Output

Place unresolved blocking questions before the prompt only when required. Then return:

```markdown
# Task

## Context

## Required inputs

## Instructions

## Constraints

## Output

## Acceptance criteria
```

## Acceptance criteria

- The prompt stands alone with the supplied inputs
- Every instruction contributes to the requested result
- Placeholders are descriptive and use `snake_case`
- Tools, data, experts, and execution environments are not invented
- When applicable, the prompt requests decisions and observable evidence, not private chain-of-thought
- Output fields and success criteria are testable
- The prompt does not promise correctness or elimination of model errors
