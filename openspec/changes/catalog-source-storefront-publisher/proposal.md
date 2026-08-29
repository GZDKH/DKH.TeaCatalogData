# catalog-source-storefront-publisher

## Summary

Extend the catalog-source Commerce publication tooling so the normal operator
path publishes through the AdminGateway storefront/catalog scoped endpoint
instead of requiring raw CommerceNetwork participant/channel identifiers.

## Existing Implementation Evidence

```yaml
existing_implementation:
  exact_matches:
    - repo: DKH.TeaCatalogData
      ref: origin/main
      revision: 294df48bbcf8802bd4844d04c3ca3a1f8dadeb7a
      path: scripts/catalog-sources/publish-commerce-observations.js
      symbol: publish-commerce-observations legacy gRPC publisher
    - repo: DKH.TeaCatalogData
      ref: origin/main
      revision: 294df48bbcf8802bd4844d04c3ca3a1f8dadeb7a
      path: scripts/catalog-sources/README.md
      symbol: participant/channel operator instructions
  related_capabilities:
    - repo: DKH.AdminGateway
      ref: origin/main
      revision: 315c625037c3d3060e2d2313105c003fca64dd52
      path: DKH.AdminGateway.Api/Controllers/CommerceNetwork/V1/CommerceNetworkStorefrontCatalogSourceImportsController.cs
      symbol: storefront/catalog scoped AdminGateway facade
  contracts:
    - AdminGateway REST route POST /api/v1.0/admin/commerce-network/storefronts/{storefrontId}/catalogs/{catalogId}/catalog-source-imports
    - AdminGateway REST route POST /api/v1.0/admin/commerce-network/storefronts/{storefrontId}/catalogs/{catalogId}/catalog-source-imports/{importId}/items
    - AdminGateway REST route POST /api/v1.0/admin/commerce-network/storefronts/{storefrontId}/catalogs/{catalogId}/catalog-source-imports/{importId}/commit
  platform_packages: []
  data_model: []
  consumers:
    - DKH.TeaCatalogData operator CLI
  tests:
    - scripts/catalog-sources/test-commerce-publication.js
  active_issues_mrs:
    - gzdkh/data/DKH.TeaCatalogData#4
  active_branches_worktrees:
    - fix/4-storefront-catalog-source-import
decision: extend
```

## Problem

The data publisher already produces a reviewed, append-only Commerce
observation canary, but the CLI and documentation still ask the operator for
internal CommerceNetwork participant/channel IDs. That is no longer the correct
business flow because AdminGateway can derive those IDs from the selected
storefront catalog and its seller counterparty.

## Scope

- Add an AdminGateway REST transport for the existing publication sequence.
- Bind REST apply receipts to the scoped route identity and sanitized target.
- Keep the existing gRPC transport as an explicit legacy diagnostics path.
- Add an explicit retail-price publication step for selected storefront catalog
  rows that already passed source-row review and exact sellable curation.
- Update operator documentation and tests.

## Non-Goals

- No direct production database writes.
- No new deployment configuration keys.
- No ProductCatalog or StorefrontService contract changes in this repository.
- No Admin UI implementation in this slice.
- No attempt to represent duplicate source rows as multiple sell-side prices on
  one ProductCatalog catalog sellable.
