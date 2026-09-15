## 1. Producer policy

- [ ] 1.1 Replace type-only filterability with an explicit semantic-key policy and add coverage for technical, unsupported, and curated attributes.
- [ ] 1.2 Enforce human-readable deterministic label fallbacks and expose fallback accounting in the existing localization summary.
- [ ] 1.3 Localize tag labels across available cards while preserving general and flavor namespaces; add cross-namespace fixtures.

## 2. Repair manifest

- [ ] 2.1 Implement a scoped, field-preserving dry-run repair planner with stable-code conflicts, desired updates, and exact rollback payloads.
- [ ] 2.2 Reuse AdminGateway DataExchange validate/import semantics with explicit apply confirmation, read-back verification, and rollback-on-failure tests.

## 3. Verification

- [ ] 3.1 Run producer unit tests, artifact validation, and deterministic repeat-run checks.
- [ ] 3.2 Validate the OpenSpec change and record the dry-run report without applying production data.
