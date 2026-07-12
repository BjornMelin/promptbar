# Diagnose web performance

Find, fix, and measure the highest-impact performance bottleneck in a representative user flow.

## Required inputs

- `target_flows`: pages and user actions that matter
- `test_conditions`: devices, browsers, network, data volume, and build mode
- `baseline_evidence`: field data, laboratory measurements, traces, or profiles
- `performance_goal`: a user requirement, budget, or cited current standard
- `repository_context`: source, build, deployment, and monitoring setup
- `behavior_constraints`: functionality, accessibility, compatibility, and delivery limits

## Instructions

1. Reproduce the baseline under documented, representative conditions.
2. Separate field data, laboratory data, and diagnostic proxy metrics.
3. Use traces, profiles, network evidence, or bundle evidence to locate the bottleneck before changing code.
4. Rank findings by measured user impact, confidence, implementation cost, and regression risk.
5. Implement the smallest high-confidence fix with existing browser, framework, and platform capabilities.
6. Avoid memoization, caching, lazy loading, virtualization, and new dependencies unless evidence supports them.
7. Repeat the same measurement under comparable conditions and report variance when it affects the conclusion.
8. Verify behavior, accessibility, and supported browsers. Add a regression check when the measurement is stable enough for automation.
9. Cite the source and date for external thresholds or platform guidance.

## Output

Return:

1. Test conditions and baseline
2. Prioritized evidence-backed findings
3. Changed files or recommended action
4. Before-and-after comparison
5. Regression and behavior verification
6. Remaining uncertainty and risks

## Acceptance criteria

- Every optimization traces to observed evidence
- Before-and-after measurements use comparable conditions
- Improvement claims include measured results and relevant variance
- Field and laboratory conclusions remain distinct
- Functional behavior and accessibility remain intact
- New dependencies have measured justification
- Targets come from requirements or cited current standards
