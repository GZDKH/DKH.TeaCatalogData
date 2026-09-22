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
   - Production snapshots use `--langs=all --field-langs=all`. Per-field details from `GET /api/v2/tea/{slug}/{lang}/field/{code}` are fetched by default for every TeaCard section field. Snapshots made with `--skip-fields`, `--skip-md`, `--skip-similar`, or partial field locales are diagnostics-only.
2. Fetch current production ProductCatalog catalog/category/geography/specification references and the complete nested `products` DataExchange baseline with the read-only `DKH.SetupTool --export-references` mode into `sources/prod/`; never substitute the products list endpoint. The older Node `fetch-prod-reference.js` and `fetch-prod-products.js` commands remain compatibility tools while operators migrate.
3. Generate the ignored, hashed artifact under `import/thetea/<id>/` with both exact references. The default catalog-assignment mode preserves unrelated placements; use `target-only` only for an approved catalog migration.
4. Validate artifact parity, baseline preservation, and prod mapping before any AdminGateway import.
5. Import through AdminGateway DataExchange only; never write directly to production DB.

## Locales

Production snapshots load all locales advertised by TheTea `/api/v2/meta.locales` with `--langs=all`.

Product translations use BCP 47 locale codes. DKH aliases TheTea `en` to `en-US`, `ru` to `ru-RU`, and `zh`/`zh-CN` to `zh-CN`; all other TheTea BCP 47 codes are preserved.

## Commands

```bash
(cd data/DKH.TeaCatalogData && node scripts/thetea/fetch-snapshot.js --snapshot=thetea-2026-06-01 --langs=all --field-langs=all --resume --concurrency=4)
# From the GZDKH workspace root, run in a SOPS-provided shell; see scripts/thetea/README.md.
dotnet run --project workers/DKH.SetupTool/DKH.SetupTool -- --export-references --snapshot=prod-canary-2026-09-22 --workspace-id=45bd2e57-d05a-4a81-90cc-a023702778be --output-root="$PWD/data/DKH.TeaCatalogData/sources/prod" --client-credentials
(cd data/DKH.TeaCatalogData && node scripts/thetea/generate-import.js --snapshot=thetea-2026-06-01 --out=import/thetea/thetea-2026-06-01 --packages=standard --catalog-ref=sources/prod/catalog-reference/prod-canary-2026-09-22.json --product-ref=sources/prod/product-reference/prod-canary-2026-09-22)
(cd data/DKH.TeaCatalogData && node scripts/thetea/validate-generated.js --dir=import/thetea/thetea-2026-06-01 --report=thetea-2026-06-01-prod-map --catalog-ref=sources/prod/catalog-reference/prod-canary-2026-09-22.json --product-ref=sources/prod/product-reference/prod-canary-2026-09-22)
(cd data/DKH.TeaCatalogData && node scripts/thetea/import-generated.js --snapshot=thetea-2026-06-01 --catalog-ref=sources/prod/catalog-reference/prod-canary-2026-09-22.json --product-ref=sources/prod/product-reference/prod-canary-2026-09-22 --storefront-id=<storefront-uuid> --only=<product-code> --limit=1)
(cd data/DKH.TeaCatalogData && node scripts/catalog-sources/fetch-snapshot.js --source=zzctea --snapshot=zzctea-2026-07-27 --resume --concurrency=4)
(cd data/DKH.TeaCatalogData && node scripts/catalog-sources/fetch-snapshot.js --source=zzctea --snapshot=zzctea-2026-07-27 --replay)
(cd data/DKH.TeaCatalogData && node scripts/catalog-sources/project-artifact.js --artifact-dir=artifacts/catalog-sources/zzctea/zzctea-2026-07-27)
(cd data/DKH.TeaCatalogData && node scripts/catalog-sources/publish-commerce-observations.js --projection-dir=artifacts/catalog-source-projections/<source>/<snapshot> --only=<external-id> --storefront-code=<storefront-code> --catalog-code=<catalog-code> --admin-url="$ADMIN_GATEWAY_REST_BASE_URL")
(cd data/DKH.TeaCatalogData && node scripts/catalog-sources/reconcile-projection.js --projection-dir=artifacts/catalog-source-projections/zzctea/zzctea-2026-07-27 --catalog-ref=sources/prod/catalog-reference/prod-2026-07-27.json --product-ref=sources/prod/product-reference/prod-products-2026-07-27 --only=17641)
# After source-access/legal clearance, run the complete resumable weekly refresh; it performs no production write
(cd data/DKH.TeaCatalogData && node scripts/catalog-sources/update-zzctea-current.js --snapshot=<id> --catalog-ref=<catalog-ref.json> --product-ref=<product-reference-dir> --previous-media-dir=<verified-prior-media-dir> --minimum-request-interval-ms=1000)
```

Use `--apply --yes` with `import-generated.js` only after explicit approval.
The Commerce observation publisher is also dry-run by default and requires the
separate `--apply --yes` confirmation for its one-item canary.

## Production Gates

- `PRODUCT_CATALOG_WORKSPACE_ID` is required for ProductCatalog export/validate/import.
- Generated validation report and artifact manifest must be valid with non-empty source/reference hashes.
- Prod mapping report must show the target catalog exists and `Missing categories: 0`.
- Full baseline overlay must preserve every unrelated replace-mode collection entry.
- ProductCatalog must preserve catalog-scoped tier-price catalog codes across product export/import before canary.
- TheTea resync is update-only: every generated product code must already exist in the marked-complete baseline. New-product creation is a separate workflow.
- Prefer `DKH.SetupTool` manifest mode for a full production load; `import-generated.js` is the explicit canary path for categories/products.
- Definitions still need their ordered downstream path before products. For full product artifacts with `targets.articleCoverage: exact-product-slug`, `import-generated.js --apply --yes` must also receive `--storefront-id`/`THETEA_STOREFRONT_ID` and applies the matching routed article/FAQ step before the product canary is considered complete.
- TheTea commercial/licensing approval must be confirmed before loading production.
- Current ZZCTea `robots.txt` disallows `/api/`; do not execute or schedule a
  live fetch until source-access and legal review explicitly clear it.
- Catalog-source snapshots and projections are immutable and content-addressed. The weekly workflow swaps `import/zzctea/current` only after source, media, reconciliation, and hash checks pass; its canonical source artifact remains `zh-CN`-only, `applyAllowed: false`, and contains observations rather than ProductCatalog retail prices.
- Human ZZCTea translations use the separate source-bound Markdown export/import round trip. They must preserve the protected manifest binding and still require a one-product translated canary plus read-back.
- Apply a one-product canary and verify read-back before requesting a separate mass apply approval.

<!-- CLAUDE-BASELINE-SHA256: 860e7f6b49baf5c7a24b1af614d6219629da1a3c5171958d8d8009ac39cb4579 -->
