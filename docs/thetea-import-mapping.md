# TheTea to DKH ProductCatalog Import Mapping

Status: typed-detail synchronization contract for `GZDKH/DKH.TeaCatalogData#15`.

This document defines what TheTea API data is stored as source material and how generated import JSON maps into the DKH ProductCatalog DataExchange structure. No production import should be applied until this mapping, the generated validation report, the exact production catalog and full-product baseline hashes, and the canary result are approved.

## Source of Truth

The source of truth is the raw API snapshot:

```text
sources/thetea/snapshots/<snapshot-id>/raw/
```

Generated ProductCatalog JSON under `import/thetea/<snapshot-id>/` is disposable and can be regenerated from the raw snapshot. The raw snapshot must be preserved as an immutable audit artifact for each production load.

## Source Endpoints

| TheTea API source | Snapshot path | ProductCatalog usage |
|---|---|---|
| `GET /docs` | `raw/source/docs.html` | API documentation audit trail. |
| `GET /openapi.yaml` | `raw/source/openapi.yaml` | API contract audit trail. |
| `GET /llms.txt` | `raw/source/llms.txt` | API method summary audit trail. |
| `GET https://tea.support/skill/SKILL.md` | `raw/source/skill.md` | External TheTea skill/source summary audit trail. |
| `GET /api/v2/meta` | `raw/meta.json` | Locale list, countries, and API metadata. Drives `--langs=all`. |
| `GET /api/v2/family` | `raw/family.json` | Reference source for later family/category enrichment. |
| `GET /api/v2/glossary?lang=<lang>` | `raw/glossary-<lang>.json` | Localized reference source for later curation. |
| `GET /api/v2/map?lang=<lang>` | `raw/map-<lang>.json` | Localized geo/source audit; origin data is still taken from TeaCard metadata/sections. |
| `GET /api/v2/teas?lang=<lang>&limit=<n>&offset=<n>` | `raw/teas-<lang>.json` | Paginated slug list and coarse product discovery. The fetcher follows pages until the final short page so future API growth is not truncated. |
| `GET /api/v2/tea/{slug}?lang=<lang>` | `raw/cards/<lang>/<slug>.json` | Main TeaCard source for product core, translations, catalog/category mapping, tags, origins, recipes, sensory data, and base specifications. |
| `GET /api/v2/tea/{slug}/{lang}/field/{code}` | `raw/fields/<lang>/<slug>/<section>/<field>.json` | Per-field details for every fetched locale in production snapshots. `value_md`, `value_num`, and `unit` are overlaid onto TeaCard fields before generation. |
| `GET /api/v2/tea/{slug}/{lang}/field/{code}` returning `404` | `raw/field-missing/<lang>/<slug>/<section>/<field>.json` | Audit trail for a TeaCard field whose detail endpoint is advertised by the card but not available from TheTea. This is a warning, not a fatal fetch error. |
| `GET /api/v2/tea/{slug}.md?lang=<lang>` | `raw/markdown/<lang>/<slug>.md` | Full localized Markdown page kept as source/audit content and routed into the article sidecar. It is never flattened into product specifications. |
| `GET /api/v2/tea/{slug}/similar?lang=<lang>&limit=12` | `raw/similar/<lang>/<slug>.json` | Source/audit payload and fallback input for `related[]`. Curated `enrichment.similar_teas` wins, followed by endpoint results; self-links and duplicates are rejected and generated relations are capped at 12. |

Query/runtime endpoints such as `/search`, `/semantic`, `/ask`, `/compare`, and `/random` are not deterministic product-source enumerations. Their contract is preserved in `raw/source/openapi.yaml`, but they are not used as canonical import input for the first load.

## Generated Import Target

The generator writes one JSON array per product, using the deterministic product code as the filename:

```text
import/thetea/<snapshot-id>/04-products/<THE_TEA_CATEGORY>/<PRODUCT-CODE>.json
```

Each file contains one ProductCatalog DataExchange product object.

The complete artifact layout is:

```text
01-reference/                 catalog reference record
02-specifications/            managed group, attribute, and option definitions
03-categories/                missing category definitions
04-products/                  one product per file
05-catalog-bindings/          catalog/category/product binding artifact
06-routed-content/articles/   localized Markdown and long narrative records
06-routed-content/metaobjects localized FAQ records
artifact-manifest.json        exact file inventory, hashes, locales, and loss events
```

Output is built in a temporary sibling directory and atomically swapped into place only after semantic and manifest validation. This removes stale files on success and leaves the previous valid output untouched on failure.

With `--catalog-ref=...`, `03-categories/categories.json` contains only definitions missing from that exact production reference, plus missing parents. Without a catalog reference, and without a full `--product-ref=...`, generation is diagnostics-only and requires explicit `--allow-missing-*` flags. A diagnostic artifact has empty reference hashes and cannot be applied.

## Product Mapping

| ProductCatalog field | TheTea source | Rule |
|---|---|---|
| `code` | TeaCard `meta.origin_country`, `slug` | `TEA-<COUNTRY>-<SLUG>`, normalized to ProductCatalog code format. Example: `TEA-CN-XIHU-LONGJING`. |
| `sku` | TeaCard `slug`, `meta.origin_country` | `<SLUG>-<COUNTRY>`, normalized. |
| `published` | Import option | `false` by default. `--publish` only after explicit approval. |
| `nativeName` | TeaCard `names.zh` / `names.zh-CN` | Chinese native name when present. |
| `transcription` | TeaCard `name` | Text inside the final parenthesized transcription segment. |
| `translations[]` | Localized TeaCards | One translation per TheTea locale from the snapshot manifest. Compact product descriptions contain enrichment and recipe summaries; full Markdown and narratives are routed separately. |
| `catalogs[]` | TeaCard `meta.tea_type`, `meta.province`, `meta.shape`, `meta.processing`, `meta.roast_level`, `meta.family_id`, TeaCard `tags` | Always assigned to `CATALOG-CHINESE-TEA`; stable TheTea taxonomy fields are mapped to type, region, shape, processing, roast, family, and specialty categories. |
| `packages[]` | Import option | Default package `PKG-50G`; `--packages=standard` adds 25g, 100g, 250g, 500g. |
| `tags[]` | TeaCard `tags`, `enrichment.flavor_tags` | Deterministic `TAG-TT-*` and `TAG-FLAVOR-*` codes. |
| `specifications[]` | TeaCard `meta`, `sections`, `recipe`, `harvest`, `sensory`, `enrichment`, field endpoints | See Specification Mapping. |
| `origins[]` | TeaCard `meta`, localized origin/terroir sections | Country, state/province, city/county, altitude, coordinates, and localized notes. |
| `related[]` | `enrichment.similar_teas`, localized `/similar` payloads, production baseline | Resolve slugs to deterministic product codes in a two-pass transform, reject self/duplicates, cap generated links at 12, and preserve existing manual links. |
| `crossSells[]` | Production full-product baseline | TheTea does not derive cross-sells; existing values are preserved unchanged. |

## Locale Mapping

Production snapshots use all locales returned by TheTea `/api/v2/meta.locales` and fetch field detail endpoints for all of those locales with `--field-langs=all`.

| TheTea locale | ProductCatalog locale |
|---|---|
| `en` | `en-US` |
| `ru` | `ru-RU` |
| `zh`, `zh-CN` | `zh-CN` |
| Other BCP 47 values | Preserved as-is, for example `zh-HK`, `zh-TW`, `nb`, `de`, `fr`. |

If a diagnostic snapshot does not contain a localized card, the generator may create name-only fallback translations for `en-US`, `ru-RU`, and `zh-CN`. This is not acceptable for the full production run; production must use `--langs=all`.

Specification group, attribute, and option definitions contain a translation row for every required product locale. Known structural labels have curated `en-US`, `ru-RU`, and `zh-CN` names. Other locales receive an explicit English fallback, recorded in the report and artifact manifest; a fallback is not represented as a source-native translation.

## Catalog and Category Mapping

All products go into:

```text
CATALOG-CHINESE-TEA
```

Tea type mapping:

| TheTea `meta.tea_type` | DKH category |
|---|---|
| `green` | `CAT-GREEN-TEA` |
| `white` | `CAT-WHITE-TEA` |
| `yellow` | `CAT-YELLOW-TEA` |
| `oolong` | `CAT-OOLONG-TEA` |
| `red` | `CAT-RED-TEA` |
| `dark` | `CAT-DARK-TEA` |
| `puer` | `CAT-PUER-TEA` |

Province mapping assigns a second region category, for example `Zhejiang -> CAT-REGION-ZHEJIANG`. Known province mappings currently include Anhui, Chongqing, Fujian, Guangdong, Guangxi, Guizhou, Hainan, Henan, Hubei, Hunan, Jiangsu, Jiangxi, Jilin, Shaanxi, Shandong, Sichuan, Taiwan, Tibet, Xinjiang, Yunnan, and Zhejiang. Unknown provinces fall back to `CAT-REGION-CHINA` with a warning and must be reviewed before production import.

Additional generated category dimensions:

| TheTea source | DKH category namespace | Notes |
|---|---|---|
| `meta.shape` | `CAT-SHAPE-*` under `CAT-BY-SHAPE` | Needle, flat, strip, spiral, brick, pearl, cake. |
| `meta.processing` | `CAT-PROC-*` under `CAT-BY-PROCESSING` | `chaoqing`, `hongqing`, `zhengqing`. |
| `meta.roast_level` | `CAT-ROAST-*` under `CAT-BY-ROAST` | `none`, `light`, `medium`, `heavy`. |
| TeaCard `tags` | `CAT-SPEC-*` under `CAT-BY-SPECIALTY` | Only stable non-duplicate tags become categories: GI, UNESCO ICH, Ten Famous Teas, Three Needles, Needle Shape. Type and region tags are ignored because they duplicate stronger fields. |
| `/api/v2/family` | `CAT-FAMILY-*` under `CAT-BY-FAMILY` | Family categories are generated as reference categories. Products are assigned to them only when TeaCard `meta.family_id` is present. In the current 2026-06-02 snapshot all TeaCard `family_id` values are empty, so family categories are not assigned to products yet. |

Fields such as `enrichment.flavor_tags`, `enrichment.occasion`, `enrichment.best_season`, `enrichment.caffeine_level`, `enrichment.difficulty`, and `enrichment.price_tier` stay as tags/specifications rather than navigation categories. They are high-cardinality filter attributes or user-context attributes, not stable catalog-tree branches.

Before import, `fetch-prod-reference.js` must capture current production catalogs/categories, and a complete nested JSON export of the ProductCatalog `products` DataExchange profile must be stored as the product baseline. Generation and every later validation/import command must use the exact same `--catalog-ref=...` and `--product-ref=...`; their SHA-256 values are recorded in `artifact-manifest.json`.

The report must show:

```text
Catalog found: yes
Missing categories: 0
```

## Specification Mapping

Every managed specification has exactly one group and one attribute. A product may contain at most one value row for a given managed attribute. Specification groups use `SPEC-TT-GROUP-<SECTION>` and all managed definitions use the `SPEC-TT-*` namespace.

| Source | ProductCatalog spec type | Code namespace |
|---|---|---|
| Controlled singleton values: tea type, shape, processing, roast level, caffeine level, difficulty, price tier | `Option` | Attribute plus one stable option code |
| Repeated scalar values: best seasons, occasions, flavor tags, food pairings, harvest months | `List` | One attribute whose `value` is a JSON array string |
| Min/max values: oxidation and brew temperature | `Range` | Both bounds are always emitted; a one-sided value becomes a point range with equal bounds |
| Known numeric values and sensory descriptor scores | `Number` | Numeric string in `value`, with a unit when the contract defines one |
| Recipe time | `Duration` | Seconds in `value`, unit `s` |
| Flags such as geographical-indication status | `Boolean` | Canonical `true`/`false` string |
| Stable short/rich text | `CustomText` / `CustomMarkdownText` | One canonical semantic attribute; field-detail prose may be routed separately instead of duplicating the value |
| Dates | `Date` | `SPEC-TT-SOURCE-LAST-UPDATED` |

Repeated objects are flattened by a stable discriminator instead of being stored as a `List<object>`: recipe by `style`, harvest by `phase`, and sensory data by descriptor. Conflicting type, unit, parent, option, or translation metadata is fatal.

When the source returns a sensory `descriptor_id` and intensity but leaves `descriptor` null, the value is still imported as a typed numeric attribute. Its visible label explicitly includes the immutable source descriptor ID; the ETL never guesses a semantic name and never drops the score.

Origin country/place, coordinates, and altitude live only in `origins[]`; altitude is not duplicated as a specification. Plausible fractional-thousand altitude defects are normalized only when contextual evidence supports it and are always reported.

All localized section prose is preserved in the article sidecar so non-canonical locale values are not collapsed. Short stable canonical values may also remain typed text specifications. Synthetic `*_xN` and `ext_*` fields, full Markdown, FAQ, and long narrative sections never become technical product attributes; they exist only in `06-routed-content/`. The current ProductCatalog importer does not ingest those sidecars, so they require a dedicated article/metaobject downstream step in the canary workflow.

The transformer does not create parallel raw and derived attributes for the same semantic. The canonical typed value is stored once; additional prose is either a distinct detail semantic or routed content.

## Replace-Mode Baseline Overlay

Product DataExchange replaces dependent collections. Re-running an upsert is safe only after overlaying the generated TheTea data onto a complete current production product export.

For an existing product, the ETL replaces managed `SPEC-TT-*` specifications and generated TheTea origins while preserving unrelated specifications, unknown-locale translations, manual tags, catalog assignments, packages, prices, store overrides, cross-sells, existing related links, and other baseline fields. Generated related links are merged with existing ones. Baseline-preservation validation fails if any unrelated collection entry would disappear or change.

For a new product, TheTea does not invent live prices, inventory, media attachment IDs, or cross-sells. Without a full product baseline hash, apply is forbidden.

## Not Derived from TheTea

These are not derived from TheTea for new products:

- Live prices, tier prices, catalog prices, and store overrides.
- Stock or inventory quantities.
- Media file uploads or ProductCatalog media attachment IDs.
- Cross-sells.
- Runtime AI answers from `/ask`, arbitrary search queries, arbitrary semantic queries, and random result samples.

Existing product values in the supported DataExchange baseline are preserved. The source contract for runtime methods remains in `raw/source/openapi.yaml`.

## Pre-Import Gates

The first production import can proceed only when all gates pass:

1. Raw source snapshot exists and has `Errors: 0`. `missing-field-detail` warnings are allowed only when TheTea returns `404` for a field endpoint; they must stay preserved under `raw/field-missing/`. Production snapshots must not have partial field locales.
2. `Source contract files: 4` are present in the snapshot.
3. Current catalog/category reference and complete `products` DataExchange JSON baseline exist.
4. Generated report and `artifact-manifest.json` have `Valid: yes`, exact file parity, and non-empty source/catalog/baseline hashes.
5. If categories are applied, fetch a new catalog reference and regenerate the entire artifact. Passing a new reference to an old artifact is rejected by hash validation.
6. Final mapping has `Catalog found: yes` and `Missing categories: 0`.
7. Definitions are imported before products through SetupTool or another approved ordered DataExchange workflow. `import-generated.js` supports only `categories` and `products`; it does not import definitions, catalog bindings, articles, or FAQ sidecars.
8. AdminGateway token passes the required `CatalogExport`/`CatalogImport` policies and workspace access.
9. A one-product canary is dry-run validated, applied only after canary approval, and read back for structural comparison.
10. User explicitly approves the separate mass `--apply --yes` step.

## First Import Commands

```bash
node scripts/thetea/fetch-snapshot.js --snapshot=thetea-2026-06-02 --langs=all --field-langs=all --concurrency=4 --resume
node scripts/thetea/fetch-prod-reference.js --snapshot=prod-2026-06-02
node scripts/thetea/fetch-prod-products.js --snapshot=prod-products-2026-06-02
node scripts/thetea/generate-import.js --snapshot=thetea-2026-06-02 --out=import/thetea/thetea-2026-06-02 --packages=standard --catalog-ref=sources/prod/catalog-reference/prod-2026-06-02.json --product-ref=sources/prod/product-reference/prod-products-2026-06-02
node scripts/thetea/validate-generated.js --dir=import/thetea/thetea-2026-06-02 --report=thetea-2026-06-02-prod-map --catalog-ref=sources/prod/catalog-reference/prod-2026-06-02.json --product-ref=sources/prod/product-reference/prod-products-2026-06-02
node scripts/thetea/import-generated.js --snapshot=thetea-2026-06-02 --catalog-ref=sources/prod/catalog-reference/prod-2026-06-02.json --product-ref=sources/prod/product-reference/prod-products-2026-06-02 --only=TEA-CN-XIHU-LONGJING --limit=1
```

Canary apply, only after explicit canary approval:

```bash
node scripts/thetea/import-generated.js --snapshot=thetea-2026-06-02 --catalog-ref=sources/prod/catalog-reference/prod-2026-06-02.json --product-ref=sources/prod/product-reference/prod-products-2026-06-02 --only=TEA-CN-XIHU-LONGJING --limit=1 --apply --yes
```

The mass product apply is a separate command and approval after canary read-back. Routed article/FAQ content is not applied by `import-generated.js`.
