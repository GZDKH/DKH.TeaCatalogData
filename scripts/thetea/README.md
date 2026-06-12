# TheTea ETL

Production-safe import flow for data from `https://api.thetea.app` into the DKH ProductCatalog DataExchange schema.

## Source Methods

Authoritative import sources:

- `GET /api/v2/teas` — slug list and coarse filters.
- `GET /api/v2/tea/{slug}` — canonical TeaCard: metadata, names, sections, recipe, harvest, sensory, tags, enrichment, SEO.
- `GET /api/v2/tea/{slug}/{lang}/field/{code}` — per-field detail. The snapshot fetches this for every field discovered under each TeaCard `sections` object and generation overlays `value_md` / `value_num` onto the card before building descriptions and specs.
- `GET /api/v2/tea/{slug}.md` — full localized Markdown page; stored as raw source content, not imported as product specifications.
- `GET /api/v2/tea/{slug}/similar` — localized similar-tea endpoint payload; stored as raw source content. Curated related products are a separate follow-up.
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

Treat `sources/thetea/snapshots/<id>/raw/` as the source of truth. It stores exact API responses and text payloads; `import/thetea/<id>/` is regenerated from that source. The snapshot also stores `raw/source/docs.html`, `raw/source/openapi.yaml`, and `raw/source/llms.txt`, so later audits can see which TheTea contract was used for the load.

Fetch the current production ProductCatalog catalog/category reference through AdminGateway:

```bash
node scripts/thetea/fetch-prod-reference.js --snapshot=prod-2026-06-01
```

Generate ProductCatalog import JSON:

```bash
node scripts/thetea/generate-import.js --snapshot=smoke --out=import/thetea/smoke --packages=standard
```

By default generation uses every locale recorded in the snapshot manifest. Pass `--langs=<list>` only for a controlled partial run.

Generation refuses snapshots without per-field endpoint details or Markdown pages unless `--allow-missing-field-details` / `--allow-missing-markdown` is passed for diagnostics only.

Generate with a production catalog/category mapping check:

```bash
node scripts/thetea/generate-import.js \
  --snapshot=thetea-2026-06-01 \
  --out=import/thetea/thetea-2026-06-01 \
  --packages=standard \
  --catalog-ref=sources/prod/catalog-reference/prod-2026-06-01.json
```

Validate generated files locally:

```bash
node scripts/thetea/validate-generated.js --dir=import/thetea/smoke --report=smoke-validation
```

Validate generated files against the current prod catalog/category snapshot:

```bash
node scripts/thetea/validate-generated.js \
  --dir=import/thetea/thetea-2026-06-01 \
  --report=thetea-2026-06-01-prod-map \
  --catalog-ref=sources/prod/catalog-reference/prod-2026-06-01.json
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
node scripts/thetea/import-generated.js --snapshot=smoke
```

Apply to the configured gateway only after approval:

```bash
node scripts/thetea/import-generated.js --snapshot=thetea-2026-06-01 --apply --yes
```

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

## Mapping Rules

- Product writes go through AdminGateway/ProductCatalogService DataExchange. Do not write directly to the production database.
- Product codes are deterministic: `TEA-<COUNTRY>-<THE_TEA_SLUG>`, uppercased and code-validator safe.
- Products are generated unpublished by default. Use `--publish` only for an approved production load.
- Production snapshots use `--langs=all --field-langs=all`, which expands TheTea `/api/v2/meta.locales` and fetches every advertised TeaCard locale plus every localized field detail endpoint.
- Production snapshots fetch per-field details for every field code in every localized TeaCard and store them under `raw/fields/<lang>/<slug>/<section>/<field>.json`; partial field-locale snapshots must not be imported as complete data.
- Production snapshots store localized Markdown under `raw/markdown/<lang>/<slug>.md`, similar endpoint payloads under `raw/similar/<lang>/<slug>.json`, and localized map payloads under `raw/map-<lang>.json`.
- Product translations use BCP 47 locale codes. DKH aliases TheTea `en` to `en-US`, `ru` to `ru-RU`, and `zh`/`zh-CN` to `zh-CN`; all other TheTea BCP 47 codes are preserved.
- Without a key, the transformer keeps name-only fallbacks for `ru-RU` and `zh-CN` from `names.ru` and `names.zh` when those localized cards are unavailable.
- First pass does not import live prices, stock, media attachment ids, related products, or cross-sells.
- Production writes are safe to re-run through SetupTool manifest mode after a
  clean preflight. The ProductCatalog DataExchange profiles upsert deterministic
  catalog/category/product codes and replace dependent product collections,
  preventing duplicate catalog/category assignments and specification rows.
- Before any production import, generate or validate with `--catalog-ref=...` from `fetch-prod-reference.js`. The report must show `Catalog found: yes` and `Missing categories: 0`.

## Specification Policy

TheTea has many fields, including stable named fields and numbered `*_xN` fields.
The ETL imports stable named fields as specifications and keeps synthetic
numbered prose in product descriptions plus raw source snapshots:

- Controlled enums become `Option` specs, for example tea type, shape, roast level, caffeine level, difficulty, season, occasion, and flavor tags.
- Min/max pairs become `Range` specs, for example oxidation, brewing temperature, and altitude.
- Numeric field payloads become `Number` specs when TheTea provides `num`.
- Numeric field endpoint payloads also create `SPEC-TT-FIELD-DETAIL-...` `CustomMarkdownText` specs so `value_md` prose is not lost when `value_num` is imported as a number.
- Rich stable prose fields become `CustomMarkdownText`.
- Unknown `*_xN` fields are not imported as specification attributes. Their text is retained in generated descriptions and the raw API source snapshot, so ProductCatalog does not get technical attributes like `TheTea Terroir Field 8`.

Stable code format:

- Groups: `SPEC-TT-GROUP-<SECTION>`
- Derived attributes from metadata/enrichment/recipes: `SPEC-TT-<SECTION>-<FIELD>`
- Raw TeaCard section attributes: `SPEC-TT-FIELD-<SECTION>-<FIELD>`
- Raw field endpoint detail attributes: `SPEC-TT-FIELD-DETAIL-<SECTION>-<FIELD>`
- Derived options: `SPEC-TT-OPT-<SECTION>-<FIELD>-<VALUE>`
- Raw TeaCard section options: `SPEC-TT-FIELD-OPT-<SECTION>-<FIELD>-<VALUE>`

`generate-import.js` also writes explicit ProductCatalog DataExchange definition
files under `02-specifications/`. SetupTool imports them before categories and
products using `specification_groups`, `specification_attributes`, and
`specification_attribute_options`, so repeated production runs upsert definitions
by code instead of relying on product import auto-creation.

Derived attributes and raw section attributes intentionally use different namespaces. For example, `meta.altitude_min/max` becomes a curated `Range` attribute, while `sections.terroir.altitude` remains available as the raw TheTea field. ProductCatalog stores one non-option custom value per product/attribute, so sharing the same attribute code would lose data.

## Production Notes

Generated snapshots, generated import JSON, and reports are ignored by git by default:

- `sources/thetea/snapshots/`
- `sources/prod/catalog-reference/`
- `import/thetea/`
- `reports/thetea/`

The legacy checked-in markdown corpus and static import dataset have been removed. Commit curated mappings, tests, and docs. Commit generated product JSON only when explicitly requested for a controlled release.

Check TheTea commercial/licensing approval before production load. The public API documentation currently marks content as preview/non-commercial, so the paid text API key should be paired with explicit permission for our intended use.
