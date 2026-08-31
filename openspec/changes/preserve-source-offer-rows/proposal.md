# preserve-source-offer-rows

## Summary

Preserve every supplier price-list row as a Commerce source-offer row while
keeping ProductCatalog sellable preparation grouped by physical identity.

## Existing Implementation Evidence

```yaml
existing_implementation:
  exact_matches:
    - repo: DKH.TeaCatalogData
      ref: origin/main
      path: scripts/catalog-sources/thetea-shop/tieguanyin-normalizer.js
      symbol: normalizeTieguanyinSnapshot
    - repo: DKH.TeaCatalogData
      ref: origin/main
      path: scripts/catalog-sources/thetea-shop/tieguanyin-importer.js
      symbol: buildPlan
  related_capabilities:
    - repo: DKH.AdminGateway
      ref: origin/main
      path: DKH.AdminGateway.Application/DTOs/CommerceNetwork/V1/CommerceSourceOfferBundleDtos.cs
      symbol: CommerceSourceOfferBundleDto
    - repo: DKH.AdminGateway
      ref: origin/main
      path: DKH.AdminGateway.Api/Controllers/CommerceNetwork/V1/CommerceNetworkSourceOfferBundlesController.cs
      symbol: preview/import source offer bundle
  contracts:
    - AdminGateway source-offer bundle DTO imports sourcePositions and validates duplicate row/client references.
    - CommerceNetwork catalog-source ingestion accepts row referencePrices with known/unknown state and source/derived provenance.
  tests:
    - scripts/catalog-sources/test-thetea-shop-tieguanyin.js
    - scripts/catalog-sources/test-thetea-shop-tieguanyin-importer.js
decision: fix
```

## Problem

The Tieguanyin source fixture contains 36 supplier rows with prices. The
existing normalizer correctly groups those rows into 25 unique exact 500 g
physical sellable candidates for ProductCatalog, but that grouped view is not a
valid source-offer import/export surface. It loses duplicate supplier price
rows that the admin UI must later show and let an operator select.

## Scope

- Add a separate normalized source-offer row projection that preserves all 36
  supplier rows.
- Add an AdminGateway-compatible `commerce-source-offer-bundle` artifact builder
  for those rows.
- Keep existing ProductCatalog exact sellable preparation at 25 grouped
  candidates.
- Prove duplicate grade/package rows remain distinct and non-cost public price
  facts remain source-reference only.

## Non-Goals

- No production AdminGateway import or materialization without an authenticated
  write session.
- No ProductCatalog contract/version change.
- No CommerceNetwork service hardcode for Tieguanyin or any other product.
- No seller stock, cost, margin, fulfilment promise, or direct order authority
  publication from this source fixture.
