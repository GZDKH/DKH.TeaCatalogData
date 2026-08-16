# TheTea Shop factual price-list snapshots

This folder contains checked-in, offline fixtures for factual rows published by
the current TheTea shop pages. It does not treat the page as ProductCatalog
retail-price, stock, seller, fulfilment or media-licensing authority.

`tieguanyin-normalizer.js` verifies the immutable row hash and classifies the
Tieguanyin price base into:

- exact fixed-package physical candidates;
- repeated price observations for one exact physical identity;
- rows blocked because the source provides no exact sale quantity.

The normalized source price observations always have `retailPrice: false` and
`publicationAllowed: false`. A later authenticated operator may use only the
physical identity candidates; publishing a seller offer or direct-order price
requires separately verified internal commercial authority.

Run the offline contract test with:

```bash
node scripts/catalog-sources/test-thetea-shop-tieguanyin.js
```

When the page changes, add a new dated fixture and review the normalized diff.
Do not edit an existing dated fixture or silently replace its `rowsSha256`.

## Canonical exact-sellable exchange fixtures

`catalog-sellable-exchange.js` projects the reviewed manifest into the public
ProductCatalog `catalog_sellable_variants` profile. The output contains only
stable business codes, the exact Unicode grade label, package/unit facts,
display order and `request_only` publication mode. It never copies source
price observations or infers a seller, offer, stock, currency, delivery area
or media right.

The checked-in `fixtures/catalog-sellable-exchange/` directory contains the
same deterministic rows as both UTF-8 CSV and real `.xlsx` workbooks:

- `tieguanyin-exact-25.*` is the 25-row desired list and becomes 25 `no-op`
  rows after an exact read-back;
- `tieguanyin-conflicts.*` covers duplicate row keys and duplicate exact target
  identities;
- `tieguanyin-blocked.*` covers missing package, quantity and unit authority;
- `expected.json` binds every fixture to the reviewed manifest and its hash.

Regenerate or verify the files offline:

```bash
node scripts/catalog-sources/generate-catalog-sellable-exchange-fixtures.js
node scripts/catalog-sources/generate-catalog-sellable-exchange-fixtures.js --check
node scripts/catalog-sources/test-catalog-sellable-exchange.js
```

Do not edit the generated CSV/XLSX files by hand. A changed source manifest,
row identity, ordering or workbook byte changes the checked evidence hashes.

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

The apply sequence retains existing `Everyday`/50 g state, appends the 25
unique exact 500 g grade values, generates exact combinations, creates
request-only SellableUnits, activates them, enables exact publication, and
groups them under the existing Product card. It copies the already approved
baseline placement's source policy and never creates retail prices, stock
claims, sellers, offers, shipping promises or media rights.

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
