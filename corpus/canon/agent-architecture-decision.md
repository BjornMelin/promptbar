# Design an agent workflow

Design and implement the least-complex model workflow that meets the stated goal and operating constraints.

## Required inputs

- `goal_and_success_criteria`: the outcome and observable definition of success
- `inputs_and_expected_outputs`: representative requests, data, and response shapes
- `available_data_and_tools`: allowed sources, application programming interfaces (APIs), commands, and permissions
- `runtime_or_repository_context`: existing code, conventions, and deployment environment
- `operating_constraints`: privacy, security, latency, cost, and reliability limits
- `evaluation_cases`: representative success, failure, and edge cases

## Instructions

1. Inspect the supplied system, callers, data flow, and repository conventions.
2. Decide whether deterministic code, one model call, a fixed workflow, or an agent loop is the least-complex valid design.
3. State assumptions only when missing information does not change safety, data ownership, or the public contract. Ask concise blocking questions otherwise.
4. Define model inputs and outputs, tool contracts, state ownership, permissions, termination conditions, and failure behavior.
5. Reuse the existing runtime, provider interfaces, libraries, and platform capabilities before adding custom infrastructure.
6. Bound turns, retries, execution time, cost, and tool permissions. Include a `termination_budget` when the design can loop.
7. Keep secrets and sensitive data out of prompts, logs, traces, and model-visible tool results unless the requirements explicitly authorize them.
8. Implement the requested artifact and add the smallest runnable evaluation that covers the target outcome and one material failure.
9. Run the repository’s relevant verification commands. Report observed evidence without inventing completed checks.

## Output

Return:

1. Assumptions or blockers
2. Architecture decision and concise rationale
3. Applicable model, tool, state, and data contracts
4. Implementation or changed files
5. Evaluation and verification evidence
6. Remaining operational risks

## Acceptance criteria

- The selected design is the least-complex option that meets the goal
- Any tool inputs are validated, and tool permissions expose only required operations
- Any persisted state has one named owner and defined retention behavior
- Any loops or retries terminate predictably
- Any model or tool failure has defined behavior
- Sensitive data follows the stated trust boundaries
- At least one runnable evaluation checks the requested outcome
- Every capability claim is supported by current code or authoritative documentation
