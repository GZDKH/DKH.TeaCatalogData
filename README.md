# DKH.TeaCatalogData

Data tooling for loading tea catalog content into ProductCatalogService.

The old checked-in markdown/product JSON corpus has been removed. Current imports are generated from TheTea API snapshots and validated against the current production ProductCatalog catalog/category state before any write.

## Structure

```text
DKH.TeaCatalogData/
├── scripts/
│   ├── thetea/                 # TheTea snapshot, transform, validation, and import workflow
│   ├── catalog-sources/        # Generic public-source snapshot runtime and reviewed connectors
│   ├── lib/config.js           # AdminGateway/Keycloak token helper
│   └── env.prod.template       # Production environment template
├── sources/                    # Ignored generated source snapshots
│   ├── thetea/snapshots/
│   ├── catalog-sources/
│   └── prod/{catalog-reference,product-reference}/
├── import/thetea/              # Ignored generated ProductCatalog JSON
├── import/zzctea/current/      # Ignored Data Import Console artifact
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

Public reference catalogs use the source-agnostic runtime under
`scripts/catalog-sources/`. ZZCTea is the first reviewed connector. One command
performs the resumable weekly refresh and atomically publishes the verified
operator bundle:

```bash
node scripts/catalog-sources/update-zzctea-current.js \
  --snapshot=zzctea-2026-07-28-weekly-v1 \
  --catalog-ref=sources/prod/catalog-reference/prod-2026-07-27.json \
  --product-ref=sources/prod/product-reference/prod-products-2026-07-28-post-import \
  --previous-media-dir=/absolute/path/to/artifacts/catalog-source-import-bundles/zzctea/current/media \
  --minimum-request-interval-ms=1000
```

The seed is the union of every exact `ZZC-<id>` in the complete, hash-verified
ProductCatalog export and IDs discovered through all 13 reviewed public
brand-filtered `/teaList` views. This preserves detail refresh for the existing
3,151 products and discovers new public products without treating the default
single-brand list as complete. The connector uses only robots-allowed public
HTML list/detail routes and never calls `/api/` or `/official/`. It downloads
reviewed source images into content-addressed local blobs, but writes no
production data. Source-generated product text contains only `zh-CN`, using the
exact Chinese source title; SEO fields are omitted for later generation by
`DKH.Platform.Seo`. Product-only PII-free envelopes and the resumable checkpoint
are stored under ignored `sources/catalog-sources/`; immutable evidence remains
under ignored `artifacts/`. See
[`scripts/catalog-sources/README.md`](scripts/catalog-sources/README.md) for
replay, drift, PII and reference-price rules.

The final stage atomically replaces ignored `import/zzctea/current/` with a
Data Import Console artifact using the same numbered layout as TheTea. Products
are split into one JSON file each under `04-products/`; local images and their
manifest are under `07-media/`. Internal source, rollback, reconciliation and
content-addressed cache evidence remains outside the selected import tree under
ignored `artifacts/`. The artifact carries `applyAllowed: false`; validate it
and run a one-product canary in Data Import Console before importing all files.

### Human translation round trip

Export a separate Markdown handoff package for each translator or target
locale. Every product becomes one UTF-8 `.md` file with protected product
identity/source hashes, Chinese source text, factual specification context, and
two editable marker sections. SEO fields are deliberately absent because
ProductCatalog generates them through `DKH.Platform.Seo`.

```bash
node scripts/catalog-sources/export-product-translations.js \
  --artifact=/absolute/path/to/import/zzctea/current \
  --locales=en-US \
  --out=/absolute/path/to/artifacts/zzctea-translations/en-US

node scripts/catalog-sources/export-product-translations.js \
  --artifact=/absolute/path/to/import/zzctea/current \
  --locales=ru-RU \
  --out=/absolute/path/to/artifacts/zzctea-translations/ru-RU
```

The translator changes only the text between
`DKH:TARGET-NAME:*` and `DKH:TARGET-DESCRIPTION:*` markers. They must keep the
front matter, markers, `translation-manifest.json`, Chinese source, and file
paths unchanged. Returned packages are accepted only when every expected
product is translated and still matches the exact source artifact.

Combine one or more returned locale packages into a new, separate Admin
Console artifact:

```bash
node scripts/catalog-sources/import-product-translations.js \
  --artifact=/absolute/path/to/import/zzctea/current \
  --translations=/absolute/path/to/artifacts/zzctea-translations/en-US,/absolute/path/to/artifacts/zzctea-translations/ru-RU \
  --out=/absolute/path/to/import/zzctea/translated/en-US-ru-RU
```

The command never mutates `current`, never writes production, preserves all
products/specifications/prices/catalog bindings/photos, recalculates every file
hash and artifact identity, and keeps `applyAllowed: false` plus
`canaryRequired: true`. Import one translated product and verify read-back
before requesting a separate full apply.

Put secrets in `.env` using `scripts/env.prod.template`. The TheTea text API key is read from `THETEA_API_KEY` or `THE_TEA_API_KEY`. ProductCatalog export/validate/import also requires `PRODUCT_CATALOG_WORKSPACE_ID`.

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

Fetch a marked complete, unpaged nested JSON product baseline through ProductCatalog DataExchange:

```bash
node scripts/thetea/fetch-prod-products.js --snapshot=prod-products-2026-06-01
```

Generate ProductCatalog import JSON and mapping report:

```bash
node scripts/thetea/generate-import.js \
  --snapshot=thetea-2026-06-01 \
  --out=import/thetea/thetea-2026-06-01 \
  --packages=standard \
  --catalog-ref=sources/prod/catalog-reference/prod-2026-06-01.json \
  --product-ref=sources/prod/product-reference/prod-products-2026-06-01
```

Generation uses every locale recorded in the snapshot manifest unless `--langs=<list>` is passed for a partial run. Without both production references, only an explicitly flagged diagnostic artifact can be generated, and that artifact cannot be applied.

Validate generated files locally:

```bash
node scripts/thetea/validate-generated.js \
  --dir=import/thetea/thetea-2026-06-01 \
  --report=thetea-2026-06-01-prod-map \
  --catalog-ref=sources/prod/catalog-reference/prod-2026-06-01.json \
  --product-ref=sources/prod/product-reference/prod-products-2026-06-01
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
node scripts/thetea/import-generated.js \
  --snapshot=thetea-2026-06-01 \
  --catalog-ref=sources/prod/catalog-reference/prod-2026-06-01.json \
  --product-ref=sources/prod/product-reference/prod-products-2026-06-01 \
  --only=TEA-CN-XIHU-LONGJING --limit=1
```

Apply only as an approved one-product canary first:

```bash
node scripts/thetea/import-generated.js \
  --snapshot=thetea-2026-06-01 \
  --catalog-ref=sources/prod/catalog-reference/prod-2026-06-01.json \
  --product-ref=sources/prod/product-reference/prod-products-2026-06-01 \
  --only=TEA-CN-XIHU-LONGJING --limit=1 --apply --yes
```

Mass apply is a separate approval after read-back comparison. `import-generated.js` supports only categories/products; definitions require an ordered SetupTool workflow, while article/FAQ sidecars require their dedicated downstream importer.
Apply preflight enforces the catalog assignment policy recorded in the hashed
artifact manifest. A `target-only` artifact intentionally replaces stale catalog
placements with the single declared target catalog; `preserve` retains unrelated
catalog placements.

## Production Gates

Before any production write:

- `reports/thetea/<id>/summary.md` must show `Valid: yes`.
- `artifact-manifest.json` must contain non-empty source, catalog-reference, and full-product-baseline hashes.
- `Prod Catalog Mapping` must show `Catalog found: yes`.
- `Missing categories` must be `0`.
- The ProductCatalog product export/import round trip must preserve catalog-scoped tier-price catalog codes; otherwise canary and mass apply are blocked.
- The load must be approved for TheTea commercial/licensing terms.
- Product DataExchange replaces dependent collections. The ETL therefore overlays managed TheTea fields on the exact complete baseline and validates that unrelated specs, tags, assignments, packages, prices, overrides, and relations are preserved. Legacy junk from the early bad import can be cleaned with `scripts/thetea/cleanup-prod-junk.js`, but apply requires `CatalogDelete`.

## Related

| Repository | Description |
|---|---|
| [DKH.ProductCatalogService](https://github.com/GZDKH/DKH.ProductCatalogService) | Consumes ProductCatalog DataExchange JSON |
| [DKH.Architecture](https://github.com/GZDKH/DKH.Architecture) | Architecture docs and shared rules |

## License

Proprietary — GZDKH Project
