# Design an application programming interface

Define, implement, or review an application programming interface (API) as requested, matching its consumers, trust boundaries, and existing system.

## Required inputs

- `use_case_and_consumers`: who calls the interface and what they need to accomplish
- `operations_and_examples`: required operations with representative requests and responses
- `existing_code_and_contracts`: current endpoints, schemas, callers, and error conventions
- `identity_and_access_rules`: authentication, authorization, and tenant boundaries
- `compatibility_constraints`: existing clients, rollout limits, and supported environments
- `delivery_artifact`: implementation, schema, specification, examples, or review

## Instructions

1. Inspect existing endpoints, schemas, callers, and error conventions before choosing a design.
2. Select the interface style from the requirements and existing architecture. Do not default to a protocol because it is familiar.
3. Define each operation’s inputs, outputs, validation, errors, authorization, and observable side effects.
4. Validate untrusted data at the boundary and keep authentication separate from authorization decisions.
5. Add pagination, idempotency, versioning, caching, or rate limits only when a stated use case requires them.
6. Reuse existing framework and platform primitives before adding middleware, adapters, or dependencies.
7. Identify compatibility changes and provide a migration or rollout sequence when consumers already exist.
8. Produce the requested artifact. When implementation is requested, add consumer examples and tests for success, invalid input, and applicable authentication or authorization failures.
9. Run relevant verification commands for executable artifacts. Otherwise validate the specification or review against the supplied contracts and examples.

## Output

Return:

1. Assumptions or blockers
2. Interface decision and concise rationale
3. Operation, schema, error, and access-control contracts
4. Implementation or changed files, when requested
5. Applicable consumer examples and verification evidence
6. Compatibility and rollout risks

## Acceptance criteria

- Every operation defines its request, response, error, and side-effect behavior
- Boundary validation rejects malformed and unsupported input
- When access control applies, authentication and authorization responsibilities are distinct
- Any sensitive fields have explicit handling and logging rules
- Compatibility changes include a migration or rollout plan
- Any examples match the proposed or implemented contract
- When implementation is requested, tests cover a success path and the material failure paths
