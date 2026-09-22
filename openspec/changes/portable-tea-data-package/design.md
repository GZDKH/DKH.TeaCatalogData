## Context

See `proposal.md` for motivation. The existing `tea.v1` files are repository
preparation artifacts, but their path, source default, and `render` metadata
make them look like a service profile and a theme integration. The existing
DataExchange envelope and stable catalog codes already provide the required
transport contract.

## Goals / Non-Goals

**Goals:**

- Preserve the data envelope and stable target codes while making source and
  theme ownership explicit.
- Make path migration deterministic for tests and operators.
- Establish contract checks before widening the typed-field work.

**Non-Goals:**

- No ProductCatalog, StorefrontService, gateway, or production data change.
- No MyTeaDB API client, export adapter, source credential, or canary import.
- No creation of catalog definitions, variants, or counterparties.

## Decisions

### Use a product-profile path with an internal schema version

The package moves to `templates/product-profiles/tea/`. JSON keeps an explicit
schema/profile version for validation. This avoids treating a repository data
folder as a platform runtime type. Retaining `tea.v1` was rejected because the
user explicitly needs a reusable template rather than a tea-bound system
contract.

### Source belongs to each record

The profile describes target mapping and contains no `sourceSystem` default.
Each record supplies `source.system`, `externalId`, revision, and retrieval
time. This preserves provenance and idempotency without coupling the package
to TeaDB. A generic `external` default was rejected because it would obscure
real evidence and weaken validation.

### Theme selection stays in theme configuration

Remove `render` objects and section IDs from data. The product profile exposes
only typed catalog fields. Storefront sections later select those stable codes
through their own settings. A data-side display hint was rejected because it
would make an import choose a merchant's theme behavior.

## Risks / Trade-offs

- [Old documentation or scripts may still name the old path] → search the
  repository and update every tracked reference; contract tests assert the new
  path and absence of the old source default.
- [A typed field may still be described with narrative markdown] → Phase 1
  field-matrix task audits each mapping and fails validation for machine-use
  fields that are not typed.
- [Current production references are incomplete] → preserve local validation
  and defer the canary to the authorised Phase 6 baseline.

## Migration Plan

1. Move the tracked preparation files as one atomic repository change.
2. Update tests/docs and validate the package locally.
3. Merge after review; old repository paths are intentionally removed because
   they are preparation artifacts, not a public service contract.
4. Roll back by reverting the data-package commit; no runtime state changes.
