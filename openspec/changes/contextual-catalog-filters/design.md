## Context

The current producer is `scripts/thetea/lib/spec-definitions.js`; its `productFacing && type` rule makes technical fields filterable. `scripts/thetea/lib/spec-labels.js` already provides curated locale labels and fallback accounting. Product tags are emitted by `scripts/thetea/lib/transform.js` as stable `TAG-TT-*` and `TAG-FLAVOR-*` codes. Existing `repair-puerh-spec-groups.js` demonstrates the supported AdminGateway DataExchange validate/import and read-back pattern.

## Goals / Non-Goals

**Goals:**

- Make shopper relevance an explicit producer policy.
- Preserve the typed product facts and stable identities.
- Produce a reviewable, deterministic repair manifest with rollback.
- Reuse existing localization and DataExchange boundaries.

**Non-Goals:**

- No new ProductCatalog protobuf fields, database writes, or direct SQL.
- No automatic production apply or tenant-wide overwrite.
- No universal engine rule based on Tea-specific code prefixes in downstream services.

## Decisions

1. **Semantic-key allowlist for default filters.** The producer owns a small, reviewed set of shopper-facing categorical semantic keys. This is safer than enabling every supported type; numeric and Boolean semantics remain available in product data for a later explicit policy.
2. **Field-preserving repair payloads.** The repair reads the current definition and overlays only targeted `filterable` and missing translation fields. Stable codes, IDs, order, publication, group, type, unit, and existing custom translations are copied unchanged.
3. **Separate local repair artifact.** The repair report contains desired updates and exact rollback records but is not part of the import artifact, preventing accidental DataExchange writes. Remote validation/apply is opt-in and uses the same multipart API helper as the existing repair.
4. **Localized tags use stable codes.** General and flavor namespaces remain distinct. Source-localized labels are preferred; canonical English labels are the deterministic fallback. Downstream grouping can consume this semantic distinction without changing the product contract in this phase.

## Risks / Trade-offs

- [Risk] A new shopper-relevant attribute may be omitted from the allowlist. → Add it through a reviewed producer policy change with a fixture and repair diff; do not infer relevance from type.
- [Risk] Existing operators intentionally enabled a technical field. → The repair only targets producer-managed codes and preserves non-target fields; conflicts are reported before apply.
- [Risk] Source tags lack translated names. → English fallback is explicit and observable in the report; raw codes are rejected as labels.

## Migration Plan

1. Generate a fresh artifact and current catalog reference.
2. Run the repair command in local dry-run mode and review the diff/rollback files.
3. Optionally run `--remote-validate` against the live AdminGateway export.
4. A separately approved rollout may use `--apply --yes`; read-back verification and rollback are mandatory.
5. Re-running the same command after a successful repair must be a no-op.
