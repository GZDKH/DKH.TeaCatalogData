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
2. Fetch current production ProductCatalog catalog/category reference into ignored snapshots under `sources/prod/catalog-reference/<id>.json`.
3. Generate ignored ProductCatalog import JSON under `import/thetea/<id>/04-products/...`.
4. Validate generated JSON and prod catalog/category mapping before any AdminGateway import.
5. Import through AdminGateway DataExchange only; never write directly to production DB.

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

Use `--apply --yes` with `import-generated.js` only after explicit approval.

## Production Gates

- Generated validation report must be valid.
- Prod mapping report must show the target catalog exists and `Missing categories: 0`.
- TheTea commercial/licensing approval must be confirmed before loading production.
- Re-runs are not idempotent until AdminGateway/ProductCatalogService supports `ImportOptions.update_existing` end to end.
