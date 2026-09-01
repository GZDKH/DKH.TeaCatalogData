# TheTea Shop factual price-list snapshots

This folder contains checked-in, offline fixtures for factual rows published by
the current TheTea shop pages. It does not treat the page as ProductCatalog
retail-price, stock, seller, fulfilment or media-licensing authority.

`tieguanyin-normalizer.js` verifies the immutable row hash and classifies the
Tieguanyin price base into:

- exact fixed-package physical candidates;
- source-offer rows preserved one-for-one from the supplier price list;
- repeated price observations for one exact physical identity;
- rows blocked because the source provides no exact sale quantity.

The normalized source price observations always have `retailPrice: false` and
`publicationAllowed: false`. A later authenticated operator may use only the
physical identity candidates; publishing a seller offer or direct-order price
requires separately verified internal commercial authority.

The ProductCatalog preparation and Commerce source-offer export are intentionally
separate projections:

- `exactCandidates` contains the 31 unique supplier grade identities projected
  across the standard 50 g, 100 g, 250 g, 500 g and 1000 g packages for
  variant/sellable/placement preparation.
- `sourceOfferRows` contains all 36 supplier price-list rows for admin
  source-offer import/export, including duplicate grade/package rows with
  different prices.

`tieguanyin-source-offer-bundle.js` builds an AdminGateway-compatible
`commerce-source-offer-bundle` from `sourceOfferRows`. The bundle preserves row
numbers, stable client references, CNY source reference prices, grade/package
offer terms, mapping hints and diagnostics. It does not publish seller cost,
margin, stock, fulfilment or direct-order authority.

Run the offline contract test with:

```bash
node scripts/catalog-sources/test-thetea-shop-tieguanyin.js
```

When the page changes, add a new dated fixture and review the normalized diff.
Do not edit an existing dated fixture or silently replace its `rowsSha256`.

## Exact-grade importer

`reconcile-thetea-shop-tieguanyin.js` is a purpose-limited production operator
for the existing `TEA-CN-TIE-GUANYIN` Product and
`CATALOG-CHINESE-TEA-SHOP` Catalog. It cannot target another Product or
Catalog. It uses AdminGateway for Product variant values/combinations and the
released ProductCatalog v5 exact-sellable contracts for combination read-back,
SellableUnit lifecycle and catalog placement.

The default command is a read-only dry-run. It prints and writes only counts,
stable codes and hashes; production GUIDs and bearer material are kept out of
the plan and receipt. Generated operator artifacts live under the gitignored
`artifacts/tieguanyin-grade-imports/` directory.

Required injected environment (never commit these values):

- `ADMIN_GATEWAY_URL`
- `ADMIN_GATEWAY_ACCESS_TOKEN`
- `PRODUCT_CATALOG_GRPC_ENDPOINT`
- `PRODUCT_CATALOG_ADMIN_TOKEN`
- `DKH_WORKSPACE_ID`
- `PRODUCT_CATALOG_PROTO_ROOT`
- `PLATFORM_PROTO_ROOT`

Dry-run:

```bash
node scripts/catalog-sources/reconcile-thetea-shop-tieguanyin.js \
  --run-id=tieguanyin-production-dry-run
```

Apply requires both switches:

```bash
node scripts/catalog-sources/reconcile-thetea-shop-tieguanyin.js \
  --run-id=tieguanyin-production-apply \
  --apply --yes
```

The apply sequence retains existing baseline state, appends the missing
supplier grade values, generates exact combinations, creates SellableUnits for
the standard 50 g, 100 g, 250 g, 500 g and 1000 g packages, activates them,
enables exact publication, and groups them under the existing Product card. It
copies the already approved baseline placement's source policy and never
creates stock claims, sellers, fulfilment promises or media rights.

After commercial approval for the selected storefront catalog, the same
operator can publish ProductCatalog retail-price authority for the 25 unique
exact 500 g rows:

```bash
node scripts/catalog-sources/reconcile-thetea-shop-tieguanyin.js \
  --run-id=tieguanyin-production-retail-prices \
  --publish-retail-prices
```

Dry-run writes `retail-price-plan.json` next to the placement plan. Apply still
requires both explicit switches:

```bash
node scripts/catalog-sources/reconcile-thetea-shop-tieguanyin.js \
  --run-id=tieguanyin-production-retail-prices-apply \
  --publish-retail-prices \
  --apply --yes
```

The retail-price step uses the existing generic ProductCatalog
`SetCatalogSellableRetailPrice` contract. It publishes one current CNY price per
unique catalog sellable, with the sellable's exact package quantity as the price
basis and included tax disclosure, then performs read-back verification.
Duplicate source rows for the same grade/package are retained as source
observations in the plan because one CatalogSellable has only one current retail
price. Rows that expose only a per-kg amount are marked as derived package
prices in the plan.

Rollback requires the private manifest from that exact apply run:

```bash
node scripts/catalog-sources/reconcile-thetea-shop-tieguanyin.js \
  --rollback=artifacts/tieguanyin-grade-imports/<run-id>/rollback.json \
  --yes
```

Rollback removes only placements created by that run and disables publication
only for SellableUnits enabled by that run. The exact identities remain safely
reusable instead of being irreversibly retired. Variant values/combinations
remain as inert Product metadata because the released contracts intentionally
do not provide an unsafe physical-delete rollback for referenced variant
history.

Retail-price apply uses immutable price revisions. The released contracts do
not provide a clear-current-price rollback; if the same run also created
placements, the private rollback manifest is updated with the latest placement
authority versions so placement rollback still works.
