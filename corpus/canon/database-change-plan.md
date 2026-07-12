# Plan a database change

Design a database change whose constraints and indexes follow the stated invariants and access patterns.

## Required inputs

- `domain_and_invariants`: required entities, relationships, and rules
- `data_examples`: representative valid, invalid, and boundary records
- `access_patterns`: named reads and writes with expected frequency and ordering
- `consistency_and_lifecycle`: transaction, concurrency, retention, and deletion requirements
- `existing_database_context`: current schema, queries, migrations, and database engine
- `operating_constraints`: volume, growth, latency, security, and recovery limits

## Instructions

1. Inspect the existing schema, queries, migrations, and ownership boundaries when provided.
2. Map every stated invariant and access pattern to the proposed data model.
3. Define keys, field types, nullability, relationships, and database-enforced constraints.
4. Add only indexes justified by named access patterns. Explain the expected read benefit and write cost.
5. Define transaction and concurrency behavior for conflicting writes.
6. Reuse native database capabilities before adding caches, duplicate stores, or application-level constraint logic.
7. For existing data, provide forward migration, backfill, and validation steps, plus a rollback or forward-recovery strategy that matches the change’s reversibility.
8. Supply representative queries or tests for critical reads, writes, constraints, and failure paths.
9. Run the available schema, migration, and test checks. Label capacity estimates that lack measurements.

## Output

Return:

1. Assumptions or blockers
2. Schema decision and concise rationale
3. Schema or executable definition
4. Access-pattern-to-index mapping
5. Migration, validation, and rollback or forward-recovery plan
6. Verification evidence and remaining operational risks

## Acceptance criteria

- Every required entity and relationship appears in the schema
- Database constraints enforce stated invariants where possible
- Every index maps to a named access pattern
- Transaction behavior covers conflicting writes
- Capacity claims use measurements or remain labeled as estimates
- Existing-data changes include validation and recovery steps
- Critical reads and writes have representative tests or queries
