# AGENTS.md

<!-- BEGIN REQUIRED-READING -->

## Required Reading (MUST read before working)

Before starting any task in this repository, read the shared DKH.AgentRules entrypoint:

1. **[AGENTS.md](../../agents/DKH.AgentRules/AGENTS.md)** — shared Codex entrypoint and on-demand trigger index

Profiles, skills, build gates, contracts, releases, and docs rules are lazy-loaded from `agents/DKH.AgentRules`. Use `../../agents/DKH.AgentRules/rules/codex/triggers.md` to decide what else to open for the current task.

---

<!-- END REQUIRED-READING -->

## Project Overview

DKH.TeaCatalogData contains TheTea ETL tooling for ProductCatalogService import data.

The previous checked-in markdown corpus and static product/category JSON files were intentionally removed. Do not recreate legacy `docs/data/products`, `import/03-categories`, or `import/04-products` as canonical source data.

## Current Data Flow

1. Fetch TheTea source payloads into ignored snapshots under `sources/thetea/snapshots/<id>/`.
   - Per-field details from `GET /api/v2/tea/{slug}/{lang}/field/{code}` are fetched by default for every TeaCard section field. Do not import snapshots created with `--skip-fields`.
2. Fetch current production ProductCatalog catalog/category reference under `sources/prod/catalog-reference/<id>.json`.
3. Fetch the complete nested JSON `products` DataExchange baseline under `sources/prod/product-reference/<id>/`; never substitute the list endpoint.
4. Generate the ignored, hashed artifact under `import/thetea/<id>/` with both exact references.
5. Validate artifact parity, baseline preservation, and prod mapping before any AdminGateway import.
6. Import through AdminGateway DataExchange only; never write directly to production DB.

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

Use `--apply --yes` with `import-generated.js` only after explicit approval.

## Production Gates

- `PRODUCT_CATALOG_WORKSPACE_ID` is required for ProductCatalog export/validate/import.
- Generated validation report and artifact manifest must be valid with non-empty source/reference hashes.
- Prod mapping report must show the target catalog exists and `Missing categories: 0`.
- Full baseline overlay must preserve every unrelated replace-mode collection entry.
- ProductCatalog must preserve catalog-scoped tier-price catalog codes across product export/import before canary.
- Definitions and routed article/FAQ content need their ordered downstream paths before the product canary is considered complete.
- TheTea commercial/licensing approval must be confirmed before loading production.
- Apply a one-product canary and verify read-back before requesting a separate mass apply approval.
