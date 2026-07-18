# CLAUDE.md

## Project Overview

DKH.TeaCatalogData contains TheTea ETL tooling for ProductCatalogService import data.

The old markdown product corpus and static JSON import dataset have been removed. Current catalog data is generated from TheTea API snapshots and validated against current production catalog/category state before import.

## Current Data Flow

1. `scripts/thetea/fetch-snapshot.js` downloads TheTea source payloads into ignored `sources/thetea/snapshots/<id>/`.
   - Per-field details from `GET /api/v2/tea/{slug}/{lang}/field/{code}` are fetched by default for every TeaCard section field. Do not import snapshots created with `--skip-fields`.
2. `scripts/thetea/fetch-prod-reference.js` reads current production catalogs/categories through AdminGateway.
3. `scripts/thetea/fetch-prod-products.js` captures a marked complete nested JSON `products` DataExchange baseline.
4. `scripts/thetea/generate-import.js` overlays TheTea-managed fields on that baseline and writes a hashed artifact.
5. `scripts/thetea/validate-generated.js` validates structure, artifact parity, baseline preservation, and prod mapping.
6. `scripts/thetea/import-generated.js` sends only categories/products to AdminGateway; definitions and routed content use ordered downstream workflows.

Never write directly to the production database.

## Locales

Production snapshots load all locales advertised by TheTea `/api/v2/meta.locales` with `--langs=all`.

Product translations use BCP 47 locale codes. DKH aliases TheTea `en` to `en-US`, `ru` to `ru-RU`, and `zh`/`zh-CN` to `zh-CN`; all other TheTea BCP 47 codes are preserved.

## Commands

```bash
node scripts/thetea/fetch-snapshot.js --snapshot=thetea-2026-06-01 --langs=all --resume --concurrency=4
node scripts/thetea/fetch-prod-reference.js --snapshot=prod-2026-06-01
node scripts/thetea/fetch-prod-products.js --snapshot=prod-products-2026-06-01
node scripts/thetea/generate-import.js --snapshot=thetea-2026-06-01 --out=import/thetea/thetea-2026-06-01 --packages=standard --catalog-ref=sources/prod/catalog-reference/prod-2026-06-01.json --product-ref=sources/prod/product-reference/prod-products-2026-06-01
node scripts/thetea/validate-generated.js --dir=import/thetea/thetea-2026-06-01 --report=thetea-2026-06-01-prod-map --catalog-ref=sources/prod/catalog-reference/prod-2026-06-01.json --product-ref=sources/prod/product-reference/prod-products-2026-06-01
node scripts/thetea/import-generated.js --snapshot=thetea-2026-06-01 --catalog-ref=sources/prod/catalog-reference/prod-2026-06-01.json --product-ref=sources/prod/product-reference/prod-products-2026-06-01 --only=<product-code> --limit=1
```

Use `--apply --yes` only after explicit approval.

## Production Gates

- `PRODUCT_CATALOG_WORKSPACE_ID` is required for ProductCatalog export/validate/import.
- `reports/thetea/<id>/summary.md` and `artifact-manifest.json` must be valid with exact source/reference hashes.
- `Prod Catalog Mapping` must show the target catalog exists.
- `Missing categories` must be `0`.
- Full baseline overlay must preserve unrelated replace-mode collections.
- Catalog-scoped tier-price catalog codes must round-trip through ProductCatalog export/import before canary.
- Definition and routed-content downstream steps must be ready before canary completion.
- TheTea commercial/licensing approval must be confirmed.
- A one-product canary and read-back verification precede a separate mass apply approval.
