# Deliver a React component

Implement a React component that follows the repository’s component, styling, state, and accessibility conventions.

## Required inputs

- `responsibility_and_context`: the component’s single job and where it is used
- `behaviors_and_states`: required default, loading, empty, error, disabled, and interactive states
- `data_and_events`: props, events, integrations, and ownership boundaries
- `repository_conventions`: existing components, primitives, styling, and test patterns
- `design_requirements`: visual tokens, responsive behavior, and supported browsers
- `accessibility_criteria`: names, semantics, keyboard behavior, focus, and announcements

## Instructions

1. Inspect current callers, shared primitives, styling, state ownership, and test patterns.
2. Reuse native Hypertext Markup Language (HTML) elements and existing components before adding code, abstractions, or dependencies.
3. Define the smallest public props and event contract with one clear state owner.
4. Implement every required state without inventing product behavior.
5. Prefer semantic HTML. Use Accessible Rich Internet Applications (ARIA) roles, states, and properties only when native HTML cannot express the required semantics.
6. Follow the repository’s language, styling, rendering, and client-boundary conventions.
7. Add memoization, animation, or virtualization only when a stated requirement or measurement supports it.
8. Test public behavior rather than implementation details. Include pointer, keyboard, and failure behavior where applicable.
9. Run the repository’s relevant lint, type, unit, browser, and accessibility checks.

## Output

Return:

1. Assumptions or blockers
2. Component and changed files
3. Public props, events, state, and accessibility contract
4. Representative usage
5. Tests and verification evidence
6. Remaining integration risks

## Acceptance criteria

- The component has one documented responsibility
- No dependency is added when existing primitives meet the requirement
- Native HTML supplies semantics where available; ARIA expresses only roles, states, and properties that native HTML cannot express
- Keyboard and focus behavior match pointer behavior
- Labels, errors, and status changes remain perceivable
- Required responsive and interaction states work
- Tests exercise public behavior and material failure paths
