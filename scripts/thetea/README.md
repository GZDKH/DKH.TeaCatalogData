# TheTea ETL

Production-safe import flow for data from `https://api.thetea.app` into the DKH ProductCatalog DataExchange schema.

## Source Methods

Authoritative import sources:

- `GET /api/v2/teas` — slug list and coarse filters.
- `GET /api/v2/tea/{slug}` — canonical TeaCard: metadata, names, sections, recipe, harvest, sensory, tags, enrichment, SEO.
- `GET /api/v2/tea/{slug}/{lang}/field/{code}` — per-field detail. The snapshot fetches this for every field discovered under each TeaCard `sections` object and generation overlays `value_md` / `value_num` onto the card before building descriptions and specs.
- `GET /api/v2/tea/{slug}.md` — full localized Markdown page; stored as raw source content and routed to article sidecars, never flattened into specifications.
- `GET /api/v2/tea/{slug}/similar` — localized similar-tea fallback for `related[]`; curated `enrichment.similar_teas` wins, then endpoint results are resolved, deduplicated, self-filtered, and capped at 12.
- `GET /api/v2/meta`, `/api/v2/family`, `/api/v2/glossary`, `/api/v2/map` — reference and map payloads for reports, category/origin checks, and later curation.

Discovery-only methods:

- `/api/v2/search`, `/api/v2/semantic`, `/api/v2/ask`, `/api/v2/compare`, `/api/v2/random`.
- These can help operators review or enrich a plan, but they are not canonical import input.

## Secrets

Put the paid TheTea key in `.env` or the shell environment. Both aliases are supported:

```dotenv
THETEA_API_KEY=<secret>
# or
THE_TEA_API_KEY=<secret>
```

The scripts print only whether a key is configured. They do not print the key.

AdminGateway validation/import uses Keycloak. `KEYCLOAK_GRANT_TYPE=client_credentials` is preferred for automation, but the `dkh-admin-gateway` service account must have a role accepted by the `CatalogImport` policy: `super-admin`, `full-access`, `catalog-manager`, or granular `catalog:import`. If using `KEYCLOAK_GRANT_TYPE=password`, the configured user needs the same access.

Current ProductCatalog export, validate, and import endpoints also require a workspace header. Set `PRODUCT_CATALOG_WORKSPACE_ID=<uuid>` or pass `--workspace-id=<uuid>`. Export needs `CatalogExport` plus workspace Viewer access; import needs `CatalogImport` plus workspace Manager access.

## Workflow

Fetch a smoke snapshot:

```bash
node scripts/thetea/fetch-snapshot.js --snapshot=smoke --langs=en --only=xihu-longjing --force
```

Fetch all localized cards when the key is configured:

```bash
node scripts/thetea/fetch-snapshot.js --snapshot=thetea-2026-06-01 --langs=all --field-langs=all
```

Field detail, Markdown, map, and similar endpoint calls are enabled by default. Use `--skip-fields`, `--skip-md`, or `--skip-similar` only for a fast diagnostic snapshot that must not be imported as complete data.

Full production snapshots are large because every localized TeaCard fans out into per-field endpoint calls. Use `--field-langs=all` for production; snapshots with partial field locales are diagnostics-only and are rejected by `generate-import.js` unless `--allow-partial-field-locales` is passed. Use bounded concurrency and resume retries instead of restarting from zero:

```bash
node scripts/thetea/fetch-snapshot.js --snapshot=thetea-2026-06-01 --langs=all --field-langs=all --concurrency=4 --resume
```

Without an API key, request starts are automatically spaced by 550 ms to stay
below the public 120 requests/minute limit. Override only when the subscribed
plan documents a different limit, using `--min-interval-ms=<number>` or
`THETEA_FETCH_MIN_INTERVAL_MS`. HTTP 429 retries honor `Retry-After` and
otherwise wait one minute instead of recording a burst of false source gaps.

Treat `sources/thetea/snapshots/<id>/raw/` as the source of truth. It stores exact API responses and text payloads; `import/thetea/<id>/` is regenerated from that source. The snapshot also stores `raw/source/docs.html`, `raw/source/openapi.yaml`, and `raw/source/llms.txt`, so later audits can see which TheTea contract was used for the load.

Fetch the current production ProductCatalog catalog/category reference through AdminGateway:

```bash
node scripts/thetea/fetch-prod-reference.js --snapshot=prod-2026-06-01
```

The same immutable reference also captures the production China province and
city dictionaries. Origin generation writes the province code and only accepts
a city parsed from TheTea prose when it resolves uniquely in that province;
otherwise the city is omitted and reported instead of being stored as a
specification or an invented reference value.

Fetch the complete, unpaged nested JSON `products` DataExchange baseline. The script writes `products.json` plus a completeness/hash manifest atomically:

```bash
node scripts/thetea/fetch-prod-products.js --snapshot=prod-products-2026-06-01
```

Do not substitute the normal products list endpoint. Product DataExchange replace mode requires all dependent collections, including specifications, tags, catalog assignments, packages, prices, origins, related products, and cross-sells.

Generate a diagnostics-only ProductCatalog artifact without production references:

```bash
node scripts/thetea/generate-import.js \
  --snapshot=smoke \
  --out=import/thetea/smoke \
  --packages=standard \
  --allow-missing-catalog-reference \
  --allow-missing-product-reference
```

By default generation uses every locale recorded in the snapshot manifest. Pass `--langs=<list>` only for a controlled partial run.

Generation refuses snapshots without per-field endpoint details or Markdown pages unless `--allow-missing-field-details` / `--allow-missing-markdown` is passed for diagnostics only.

Generate a production-eligible artifact with exact catalog and full-product references:

```bash
node scripts/thetea/generate-import.js \
  --snapshot=thetea-2026-06-01 \
  --out=import/thetea/thetea-2026-06-01 \
  --packages=standard \
  --catalog-ref=sources/prod/catalog-reference/prod-2026-06-01.json \
  --product-ref=sources/prod/product-reference/prod-products-2026-06-01
```

The resync workflow fails if a generated product code is absent from the marked complete baseline. New-product creation is intentionally outside this workflow.

Validate generated files locally:

```bash
node scripts/thetea/validate-generated.js \
  --dir=import/thetea/smoke \
  --report=smoke-validation
```

Validate generated files against the current prod catalog/category snapshot:

```bash
node scripts/thetea/validate-generated.js \
  --dir=import/thetea/thetea-2026-06-01 \
  --report=thetea-2026-06-01-prod-map \
  --catalog-ref=sources/prod/catalog-reference/prod-2026-06-01.json \
  --product-ref=sources/prod/product-reference/prod-products-2026-06-01
```

Check that the generated data is ready for POS catalog browsing:

```bash
node scripts/thetea/check-seed-readiness.js \
  --dir=import/thetea/thetea-2026-06-01 \
  --catalog-ref=sources/prod/catalog-reference/prod-2026-06-01.json \
  --report=thetea-2026-06-01-pos-readiness \
  --min-products=1 \
  --min-categories=1
```

For full production snapshots, set `--min-products` and `--min-categories` to
the expected load size. The gate must report `Ready: yes`, a found/published
catalog, published products, required EN/RU/ZH locale coverage, and non-zero
category assignments. If this gate fails, POS can have working catalog APIs but
still show an empty product/category surface.

The required catalog defaults to `CATALOG-CHINESE-TEA`. If prod uses another catalog code for this load, pass `--catalog=<CODE>` to `generate-import.js` and `validate-generated.js`.

Run fixture tests:

```bash
node scripts/thetea/test-transform.js
```

Validate through AdminGateway without writing:

```bash
node scripts/thetea/import-generated.js \
  --snapshot=thetea-2026-06-01 \
  --catalog-ref=sources/prod/catalog-reference/prod-2026-06-01.json \
  --product-ref=sources/prod/product-reference/prod-products-2026-06-01 \
  --only=TEA-CN-XIHU-LONGJING \
  --limit=1
```

Apply to the configured gateway only after approval:

```bash
node scripts/thetea/import-generated.js \
  --snapshot=thetea-2026-06-01 \
  --catalog-ref=sources/prod/catalog-reference/prod-2026-06-01.json \
  --product-ref=sources/prod/product-reference/prod-products-2026-06-01 \
  --only=TEA-CN-XIHU-LONGJING \
  --limit=1 \
  --apply --yes
```

That command is a canary, not a mass load. Read the product back and compare its group/attribute/value structure before requesting a separate mass-apply approval. Apply is forbidden when either reference hash or the source snapshot hash is missing or changed.

Clean legacy junk from the earlier bad imports only after reviewing the dry-run
list. This removes legacy full-page/similar attributes, synthetic `*_xN`
field attributes (`SPEC-TT-FIELD...-Xn`), and obsolete markdown/related/`EXT`
groups through AdminGateway delete endpoints:

```bash
node scripts/thetea/cleanup-prod-junk.js
node scripts/thetea/cleanup-prod-junk.js --apply --yes
```

Cleanup apply requires a token accepted by `CatalogDelete` (`catalog:delete`,
`full-access`, or `super-admin`). A token with only `catalog:import` can import
data but cannot delete legacy specification definitions.

If AdminGateway cannot propagate delete identity to ProductCatalogService, use
the gRPC service-API cleanup runner after reviewing its dry-run. It still reads
through AdminGateway and still only deletes allowlisted junk definitions:

```bash
node scripts/thetea/cleanup-prod-junk-grpc.js --grpc-url=10.10.10.101:5003
node scripts/thetea/cleanup-prod-junk-grpc.js --grpc-url=10.10.10.101:5003 --apply --yes
```

For full production loads, prefer `DKH.SetupTool` manifest mode over
`import-generated.js`. SetupTool performs manifest preflight, imports catalogs,
categories, and products in one ordered run, refreshes the Keycloak token during
long imports, and retries one `401` after token refresh.

The generated `artifact-manifest.json` is an ETL integrity manifest, not a
SetupTool execution manifest. An operator must still assemble the approved
ordered SetupTool workflow, including specification definitions before products.

## Mapping Rules

- Product writes go through AdminGateway/ProductCatalogService DataExchange. Do not write directly to the production database.
- Product codes are deterministic: `TEA-<COUNTRY>-<THE_TEA_SLUG>`, uppercased and code-validator safe.
- Products are generated unpublished by default. Use `--publish` only for an approved production load.
- Production snapshots use `--langs=all --field-langs=all`, which expands TheTea `/api/v2/meta.locales` and fetches every advertised TeaCard locale plus every localized field detail endpoint.
- Production snapshots fetch per-field details for every field code in every localized TeaCard and store them under `raw/fields/<lang>/<slug>/<section>/<field>.json`; partial field-locale snapshots must not be imported as complete data.
- Production snapshots store localized Markdown under `raw/markdown/<lang>/<slug>.md`, similar endpoint payloads under `raw/similar/<lang>/<slug>.json`, and localized map payloads under `raw/map-<lang>.json`.
- Product translations use BCP 47 locale codes. DKH aliases TheTea `en` to `en-US`, `ru` to `ru-RU`, and `zh`/`zh-CN` to `zh-CN`; all other TheTea BCP 47 codes are preserved.
- Without a key, the transformer keeps name-only fallbacks for `ru-RU` and `zh-CN` from `names.ru` and `names.zh` when those localized cards are unavailable.
- Similar-tea inputs populate `related[]`. Existing related links and cross-sells are preserved from the complete production baseline; TheTea does not derive cross-sells.
- Product DataExchange replaces dependent collections. Safety comes from overlaying generated TheTea fields on the exact complete baseline, not from upsert alone. Unrelated specs, translations, tags, catalog assignments, packages, prices, overrides, relations, and other baseline fields are preserved and validated.
- Before any production import, use both `--catalog-ref=...` and `--product-ref=...`. The report must show `Catalog found: yes`, `Missing categories: 0`, exact artifact parity, and non-empty source/reference hashes.
- `artifact-manifest.json` inventories every generated file and hash. Generation uses an atomic staging/swap, so stale files are removed only after the replacement bundle validates.

## Specification Policy

Every managed specification has exactly one group and one attribute. A product has at most one row per managed attribute; conflicting type, unit, parent, option, or translation metadata is fatal.

- Controlled singletons become `Option`: tea type, shape, processing, roast, caffeine, difficulty, and price tier.
- Repeated scalar arrays become one `List` value encoded as a JSON array string: seasons, occasions, flavor tags, food pairings, and harvest months.
- Oxidation and brew temperature become `Range`; a missing bound is copied into a point range. Altitude lives only in `ProductOrigin`.
- Known numeric values and sensory scores become `Number`; recipe time becomes `Duration` in seconds; flags become `Boolean`.
- Repeated objects are flattened by stable discriminator: recipe `style`, harvest `phase`, sensory descriptor.
- All localized section prose is copied to the article sidecar so non-canonical locale values are preserved. Short stable canonical text may also remain a typed text spec; synthetic `*_xN`/`ext_*`, full Markdown, long narratives, and FAQ never become technical attributes and live only under `06-routed-content/`.
- A raw field and a derived field never coexist under different codes for the same semantic. Canonical typed data is stored once; extra prose is a distinct detail semantic or routed content.

Stable code format:

- Groups: `SPEC-TT-GROUP-<SECTION>`
- Derived attributes from metadata/enrichment/recipes: `SPEC-TT-<SECTION>-<FIELD>`
- Stable TeaCard section attributes: `SPEC-TT-FIELD-<SECTION>-<FIELD>`
- Distinct field endpoint detail attributes: `SPEC-TT-FIELD-DETAIL-<SECTION>-<FIELD>`
- Derived options: `SPEC-TT-OPT-<SECTION>-<FIELD>-<VALUE>`
- Raw TeaCard section options: `SPEC-TT-FIELD-OPT-<SECTION>-<FIELD>-<VALUE>`

`generate-import.js` writes explicit ProductCatalog DataExchange definition
files under `02-specifications/`. SetupTool imports them before categories and
products using `specification_groups`, `specification_attributes`, and
`specification_attribute_options`, so repeated production runs upsert definitions
by code instead of relying on product import auto-creation.

Definitions include every required locale. Known structural labels have curated `en-US`, `ru-RU`, and `zh-CN` names; other locales receive an explicitly reported English fallback.

`import-generated.js` imports only `categories` or `products`. It does not import definition files or catalog bindings. Use SetupTool or another approved ordered workflow for definitions before products.

Import routed articles and localized product FAQ metaobjects through the supported Storefront APIs:

```bash
# Read-only diff (default)
node scripts/thetea/import-routed-content.js \
  --snapshot=<snapshot-id> \
  --storefront-id=<storefront-uuid> \
  --only=xihu-longjing

# Apply only after reviewing the exact diff
node scripts/thetea/import-routed-content.js \
  --snapshot=<snapshot-id> \
  --storefront-id=<storefront-uuid> \
  --only=xihu-longjing \
  --catalog-ref=<immutable-catalog-reference.json> \
  --product-ref=<immutable-full-product-reference.json> \
  --apply --yes
```

The importer upserts draft articles by slug and one `product_faq` entry per product. FAQ values retain `product_code`, `article_slug`, and every localized question/answer set. It refuses to overwrite an unowned article or an incompatible existing definition, and refuses apply for a diagnostic artifact or when the immutable source/catalog/product hashes cannot be re-verified. It writes a rollback artifact before any mutation and re-reads all selected resources after apply. The apply succeeds only when the verification pass reports every resource as `noop`.

## Production Notes

Generated snapshots, generated import JSON, and reports are ignored by git by default:

- `sources/thetea/snapshots/`
- `sources/prod/catalog-reference/`
- `sources/prod/product-reference/`
- `import/thetea/`
- `reports/thetea/`

The legacy checked-in markdown corpus and static import dataset have been removed. Commit curated mappings, tests, and docs. Commit generated product JSON only when explicitly requested for a controlled release.

Check TheTea commercial/licensing approval before production load. The public API documentation currently marks content as preview/non-commercial, so the paid text API key should be paired with explicit permission for our intended use.
