# DKH.TeaCatalogData

Data tooling for loading tea catalog content into ProductCatalogService.

The old checked-in markdown/product JSON corpus has been removed. Current imports are generated from TheTea API snapshots and validated against the current production ProductCatalog catalog/category state before any write.

## Structure

```text
DKH.TeaCatalogData/
├── scripts/
│   ├── thetea/                 # TheTea snapshot, transform, validation, and import workflow
│   ├── lib/config.js           # AdminGateway/Keycloak token helper
│   └── env.prod.template       # Production environment template
├── sources/                    # Ignored generated source snapshots
│   ├── thetea/snapshots/
│   └── prod/catalog-reference/
├── import/thetea/              # Ignored generated ProductCatalog JSON
├── reports/thetea/             # Ignored generated validation/mapping reports
└── AGENTS.md / CLAUDE.md       # Agent context
```

## Locales

Production snapshots load every locale advertised by TheTea `/api/v2/meta.locales` using `--langs=all`. At the time of writing the public docs show 72 locales.

Product translations use BCP 47 locale codes from TheTea, with DKH aliases for existing storefront defaults:

- TheTea `en` -> `en-US`
- TheTea `ru` -> `ru-RU`
- TheTea `zh` / `zh-CN` -> `zh-CN`
- Other TheTea locales keep their BCP 47 code, for example `zh-HK`, `nb`, `de`, `fr`.

## Workflow

Put secrets in `.env` using `scripts/env.prod.template`. The TheTea text API key is read from `THETEA_API_KEY` or `THE_TEA_API_KEY`.

Fetch TheTea source snapshot:

```bash
node scripts/thetea/fetch-snapshot.js --snapshot=thetea-2026-06-01 --langs=all
```

The snapshot fetches per-field details by default using `GET /api/v2/tea/{slug}/{lang}/field/{code}` for every field discovered in every TeaCard. It also stores localized Markdown pages, localized map payloads, and similar-tea endpoint payloads. Use `--skip-fields`, `--skip-md`, or `--skip-similar` only for fast diagnostic runs that will not be imported as complete data.

For a production-size run, use a conservative concurrency and resume on retry:

```bash
node scripts/thetea/fetch-snapshot.js --snapshot=thetea-2026-06-01 --langs=all --concurrency=4 --resume
```

The source of truth is the raw API snapshot under `sources/thetea/snapshots/<id>/raw/`. Generated files under `import/thetea/<id>/` are disposable derived artifacts. Each snapshot also stores the API contract files from the same run under `raw/source/` (`docs.html`, `openapi.yaml`, `llms.txt`) for audit and replay.

Fetch current production catalog/category reference through AdminGateway:

```bash
node scripts/thetea/fetch-prod-reference.js --snapshot=prod-2026-06-01
```

Generate ProductCatalog import JSON and mapping report:

```bash
node scripts/thetea/generate-import.js \
  --snapshot=thetea-2026-06-01 \
  --out=import/thetea/thetea-2026-06-01 \
  --packages=standard \
  --catalog-ref=sources/prod/catalog-reference/prod-2026-06-01.json
```

Generation uses every locale recorded in the snapshot manifest unless `--langs=<list>` is passed for a partial run.

Validate generated files locally:

```bash
node scripts/thetea/validate-generated.js \
  --dir=import/thetea/thetea-2026-06-01 \
  --report=thetea-2026-06-01-prod-map \
  --catalog-ref=sources/prod/catalog-reference/prod-2026-06-01.json
```

Check that the generated data will make the POS catalog visible instead of
empty:

```bash
node scripts/thetea/check-seed-readiness.js \
  --dir=import/thetea/thetea-2026-06-01 \
  --catalog-ref=sources/prod/catalog-reference/prod-2026-06-01.json \
  --report=thetea-2026-06-01-pos-readiness \
  --min-products=1 \
  --min-categories=1
```

For production loads, raise `--min-products` and `--min-categories` to the
expected snapshot size. The report must show `Ready: yes`, `Catalog found: yes`,
`Catalog published: yes`, and non-zero published products/category assignments.

Validate through AdminGateway without writing:

```bash
node scripts/thetea/import-generated.js --snapshot=thetea-2026-06-01
```

Apply only after approval:

```bash
node scripts/thetea/import-generated.js --snapshot=thetea-2026-06-01 --apply --yes
```

## Production Gates

Before any production write:

- `reports/thetea/<id>/summary.md` must show `Valid: yes`.
- `Prod Catalog Mapping` must show `Catalog found: yes`.
- `Missing categories` must be `0`.
- The load must be approved for TheTea commercial/licensing terms.
- Re-runs through SetupTool/DataExchange upsert deterministic codes and replace
  dependent product collections. Legacy junk from the early bad import can be
  cleaned with `scripts/thetea/cleanup-prod-junk.js`, but apply requires
  `CatalogDelete`.

## Related

| Repository | Description |
|---|---|
| [DKH.ProductCatalogService](https://github.com/GZDKH/DKH.ProductCatalogService) | Consumes ProductCatalog DataExchange JSON |
| [DKH.Architecture](https://github.com/GZDKH/DKH.Architecture) | Architecture docs and shared rules |

## License

Proprietary — GZDKH Project
