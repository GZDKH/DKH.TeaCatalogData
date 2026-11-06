## Why

The current complete destination export uses `packageBindings`, while the old
producer requires and emits retired package, price and origin fields. A fresh
TheTea inventory also includes category articles that must enter knowledge
content without becoming products.

## What Changes

Extend the existing producer and immutable acquisition flow to preserve the
current product contract and source identity. Keep historical complete baselines
replayable, reject mixed/retired current payloads, and route category articles to
native SetupTool content records separately from products. Preserve unrelated
destination fields, catalogs and package bindings; never infer commerce values.

## Capabilities

### New Capabilities

- `thetea-current-product-projection`: current-schema source projection and stable identity preservation.
- `thetea-knowledge-projection`: category acquisition and source-bound knowledge preparation.

- `thetea-api-source-completeness`: API-only card-field provenance and metadata-counted reference acquisition.

### Modified Capabilities

No living specification changes. These specifications record the scoped extension
of the existing ETL; no replacement ingestion service is introduced.

## Impact

Decision: **extend**, with an existing-contract repair in SetupTool. Source
discovery inspected TeaCatalogData `origin/main` `0df90357`, including
`generate-import.js`, `lib/product-reference.js`, `lib/product-overlay.js`,
`fetch-snapshot.js`, `lib/source-entities.js` and their tests. Existing routed
content DTO preparation and SetupTool's resumable import are reused. No living
specifications were present; existing source-completeness and portable-package
change specifications remain historical acceptance references.

Live evidence is an authenticated 3,854-product complete export with seven
current nested collections, and source discovery separating 878 teas from 164
topics. These counts are observations, never hard-coded import targets.
SetupTool issue 34/MR 98 repairs current reference export and symmetric readback;
TeaCatalogData issue 62 owns this producer delta. The leased branch is
`fix/62-current-thetea-refresh-01a1ac6a` in the chat's managed TeaCatalogData
worktree. Personal execution is in `denis-u6e`.

There are no database writes, destination contract migrations, permission
changes, price inference or automatic mass apply in this source change. Actual
canary, mass approval, reconciliation and runtime acceptance remain required.

## Existing implementation evidence

```yaml
existing_implementation:
  exact_matches: [scripts/thetea/generate-import.js, scripts/thetea/fetch-snapshot.js]
  related_capabilities: [complete-baseline overlay, routed article and FAQ DTOs, D1 field packs]
  contracts: [current DataExchange packageBindings export, TheTea OpenAPI 2.2 TeaCard and categories]
  platform_packages: [existing SetupTool Platform service identity]
  data_model: [complete products baseline, category article sidecars]
  consumers: [DKH.SetupTool manifest import, native routed-content import]
  tests: [test-product-overlay.js, test-generate-safety.js, test-source-entities.js]
  active_issues_mrs: [TeaCatalogData issue62, SetupTool issue34 MR98]
  active_branches_worktrees: [fix/62-current-thetea-refresh-01a1ac6a, fix/34-current-catalog-contract-01a1ac6a]
decision: extend
evidence:
  - repo: DKH.TeaCatalogData
    ref: origin/main
    revision: 0df90357ef3f496c18d55cf0dc65aa0f594fc90d
    path: scripts/thetea/lib/product-reference.js
    symbol: validateProductArray
  - repo: DKH.TeaCatalogData
    ref: origin/main
    revision: 0df90357ef3f496c18d55cf0dc65aa0f594fc90d
    path: scripts/thetea/lib/routed-content.js
    symbol: articleDto
```
