# CLAUDE.md

## Project Overview

DKH.TeaCatalogData contains TheTea ETL tooling for ProductCatalogService import data.

The old markdown product corpus and static JSON import dataset have been removed. Current catalog data is generated from TheTea API snapshots and validated against current production catalog/category state before import.

## Current Data Flow

1. `scripts/thetea/fetch-snapshot.js` downloads TheTea source payloads into ignored `sources/thetea/snapshots/<id>/`.
   - Per-field details from `GET /api/v2/tea/{slug}/{lang}/field/{code}` are fetched by default for every TeaCard section field. Do not import snapshots created with `--skip-fields`.
2. `scripts/thetea/fetch-prod-reference.js` reads current production catalogs/categories through AdminGateway into ignored `sources/prod/catalog-reference/<id>.json`.
3. `scripts/thetea/generate-import.js` transforms snapshots into ignored `import/thetea/<id>/04-products/...`.
4. `scripts/thetea/validate-generated.js` validates structure and prod category mapping.
5. `scripts/thetea/import-generated.js` sends generated files to AdminGateway validate/import endpoints.

Never write directly to the production database.

## Locales

Production snapshots load all locales advertised by TheTea `/api/v2/meta.locales` with `--langs=all`.

Product translations use BCP 47 locale codes. DKH aliases TheTea `en` to `en-US`, `ru` to `ru-RU`, and `zh`/`zh-CN` to `zh-CN`; all other TheTea BCP 47 codes are preserved.

## Commands

```bash
node scripts/thetea/fetch-snapshot.js --snapshot=thetea-2026-06-01 --langs=all --resume --concurrency=4
node scripts/thetea/fetch-prod-reference.js --snapshot=prod-2026-06-01
node scripts/thetea/generate-import.js --snapshot=thetea-2026-06-01 --out=import/thetea/thetea-2026-06-01 --packages=standard --catalog-ref=sources/prod/catalog-reference/prod-2026-06-01.json
node scripts/thetea/validate-generated.js --dir=import/thetea/thetea-2026-06-01 --report=thetea-2026-06-01-prod-map --catalog-ref=sources/prod/catalog-reference/prod-2026-06-01.json
node scripts/thetea/import-generated.js --snapshot=thetea-2026-06-01
```

Use `--apply --yes` only after explicit approval.

## Production Gates

- `reports/thetea/<id>/summary.md` must show `Valid: yes`.
- `Prod Catalog Mapping` must show the target catalog exists.
- `Missing categories` must be `0`.
- TheTea commercial/licensing approval must be confirmed.
- Production re-runs are not idempotent until AdminGateway exposes and ProductCatalogService honors `ImportOptions.update_existing`.
