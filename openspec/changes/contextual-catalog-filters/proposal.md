## Why

The TheTea producer currently marks every product-facing `Option`, `Number`, `Range`, and `Boolean` attribute as filterable. That exposes recipe measurements, rinse flags, sensory source descriptors, and source metadata as storefront filters, while tag and label data can fall back to English or technical identifiers. The change is needed before the next catalog repair so generated data has an explicit shopper relevance policy and a reviewable, reversible API repair path.

## What Changes

- Replace type-only filterability defaults with an explicit shopper-relevance allowlist keyed by semantic attribute keys.
- Keep technical, source, narrative, list, duration, and Boolean attributes out of the default shopper filter set unless explicitly allowlisted.
- Make missing definition labels resolve through deterministic human-readable English fallbacks and reject raw definition codes as labels.
- Preserve separate general and flavor tag namespaces and provide deterministic localized tag labels with English fallback when a source translation is absent.
- Add a dry-run repair manifest for existing specification definitions that reports only allowlisted filterability/translation changes, preserves IDs and unrelated operator fields, and emits exact rollback payloads.
- Keep production writes behind the existing supported AdminGateway DataExchange validate/import flow; this change does not apply production data.

## Capabilities

### New Capabilities

- `producer-filter-semantics`: Generates shopper-relevant, localized filter metadata and a stable semantic distinction between general and flavor tags.
- `filter-definition-repair`: Produces an idempotent supported-API repair manifest, dry-run diff, and rollback for existing definitions.

### Modified Capabilities

- None.

## Impact

- TheTea ETL scripts under `scripts/thetea/`, generated specification definitions, product tag generation, and definition repair reports.
- AdminGateway DataExchange payloads remain the supported integration boundary; no protobuf or database schema changes are introduced.
- Existing product/source facts, stable codes, IDs, custom order/published settings, and unrelated tenants remain outside the repair scope.
