# TheTea to DKH ProductCatalog Import Mapping

Status: pre-import review document for `GZDKH/DKH.TeaCatalogData#14`.

This document defines what TheTea API data is stored as source material and how generated import JSON maps into the DKH ProductCatalog DataExchange structure. No production import should be applied until this mapping, the generated validation report, and the production category mapping report are approved.

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
| `GET /api/v2/tea/{slug}.md?lang=<lang>` | `raw/markdown/<lang>/<slug>.md` | Full localized Markdown page kept as source/audit content. It is not imported as product specifications. |
| `GET /api/v2/tea/{slug}/similar?lang=<lang>&limit=12` | `raw/similar/<lang>/<slug>.json` | Localized similar-tea payload kept as source/audit content. Curated related-product links are a separate follow-up. |

Query/runtime endpoints such as `/search`, `/semantic`, `/ask`, `/compare`, and `/random` are not deterministic product-source enumerations. Their contract is preserved in `raw/source/openapi.yaml`, but they are not used as canonical import input for the first load.

## Generated Import Target

The generator writes one JSON array per product:

```text
import/thetea/<snapshot-id>/04-products/<THE_TEA_CATEGORY>/<slug>.json
```

Each file contains one ProductCatalog DataExchange product object.

The generator also writes category definitions derived from the same snapshot:

```text
import/thetea/<snapshot-id>/03-categories/categories.json
```

When `--catalog-ref=...` is provided, `03-categories/categories.json` contains only category definitions missing from the production catalog reference, plus any missing parents. Without `--catalog-ref`, it contains the full generated TheTea taxonomy for local review and must not be applied directly to production, because category import can update existing category records.

## Product Mapping

| ProductCatalog field | TheTea source | Rule |
|---|---|---|
| `code` | TeaCard `meta.origin_country`, `slug` | `TEA-<COUNTRY>-<SLUG>`, normalized to ProductCatalog code format. Example: `TEA-CN-XIHU-LONGJING`. |
| `sku` | TeaCard `slug`, `meta.origin_country` | `<SLUG>-<COUNTRY>`, normalized. |
| `published` | Import option | `false` by default. `--publish` only after explicit approval. |
| `nativeName` | TeaCard `names.zh` / `names.zh-CN` | Chinese native name when present. |
| `transcription` | TeaCard `name` | Text inside the final parenthesized transcription segment. |
| `translations[]` | Localized TeaCards | One translation per TheTea locale from snapshot manifest. The description is built from enrichment, recipes, and selected section details. |
| `catalogs[]` | TeaCard `meta.tea_type`, `meta.province`, `meta.shape`, `meta.processing`, `meta.roast_level`, `meta.family_id`, TeaCard `tags` | Always assigned to `CATALOG-CHINESE-TEA`; stable TheTea taxonomy fields are mapped to type, region, shape, processing, roast, family, and specialty categories. |
| `packages[]` | Import option | Default package `PKG-50G`; `--packages=standard` adds 25g, 100g, 250g, 500g. |
| `tags[]` | TeaCard `tags`, `enrichment.flavor_tags` | Deterministic `TAG-TT-*` and `TAG-FLAVOR-*` codes. |
| `specifications[]` | TeaCard `meta`, `sections`, `recipe`, `harvest`, `sensory`, `enrichment`, field endpoints | See Specification Mapping. |
| `origins[]` | TeaCard `meta`, localized origin/terroir sections | Country, state/province, city/county, altitude, coordinates, and localized notes. |

## Locale Mapping

Production snapshots use all locales returned by TheTea `/api/v2/meta.locales` and fetch field detail endpoints for all of those locales with `--field-langs=all`.

| TheTea locale | ProductCatalog locale |
|---|---|
| `en` | `en-US` |
| `ru` | `ru-RU` |
| `zh`, `zh-CN` | `zh-CN` |
| Other BCP 47 values | Preserved as-is, for example `zh-HK`, `zh-TW`, `nb`, `de`, `fr`. |

If a diagnostic snapshot does not contain a localized card, the generator may create name-only fallback translations for `en-US`, `ru-RU`, and `zh-CN`. This is not acceptable for the full production run; production must use `--langs=all`.

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

Before import, `fetch-prod-reference.js` must capture the current production catalog/categories. `generate-import.js` or `validate-generated.js` must be run with `--catalog-ref=...`; the report must show:

```text
Catalog found: yes
Missing categories: 0
```

## Specification Mapping

Specification groups use `SPEC-TT-GROUP-<SECTION>`.

| Source | ProductCatalog spec type | Code namespace |
|---|---|---|
| Controlled values such as tea type, shape, roast level, caffeine level, seasons, occasions, flavor tags | `Option` | `SPEC-TT-*` or `SPEC-TT-FIELD-*` plus option code |
| Min/max pairs such as oxidation, brew temperature, altitude | `Range` | `SPEC-TT-<SECTION>-<FIELD>` |
| Numeric field endpoint values (`value_num`) | `Number` | `SPEC-TT-FIELD-<SECTION>-<FIELD>` |
| Full field endpoint prose (`value_md`) from the primary card locale | `CustomMarkdownText` | `SPEC-TT-FIELD-DETAIL-<SECTION>-<FIELD>` |
| Rich TeaCard section prose | `CustomMarkdownText` | `SPEC-TT-FIELD-<SECTION>-<FIELD>` |
| List-like values | `List` | `SPEC-TT-*` |
| Dates | `Date` | `SPEC-TT-SOURCE-LAST-UPDATED` |

Unknown TheTea numbered fields such as `*_xN` are retained with deterministic names instead of being dropped.

## Not Imported in First Load

These are intentionally not written in the first import:

- Prices, tier prices, catalog prices.
- Stock or inventory quantities.
- Media file uploads or ProductCatalog media attachment IDs.
- Cross-sells as product relations.
- Runtime AI answers from `/ask`, arbitrary search queries, arbitrary semantic queries, and random result samples.

The source contract for those methods remains in `raw/source/openapi.yaml`.

## Pre-Import Gates

The first production import can proceed only when all gates pass:

1. Raw source snapshot exists and has `Errors: 0`. `missing-field-detail` warnings are allowed only when TheTea returns `404` for a field endpoint; they must stay preserved under `raw/field-missing/`. Production snapshots must not have partial field locales.
2. `Source contract files: 4` are present in the snapshot.
3. Generated report has `Valid: yes`.
4. If new TheTea categories are missing in prod, `03-categories/categories.json` is generated with `--catalog-ref=...`, dry-run validated through `--profile=categories`, applied only after approval, and prod references are fetched again.
5. Final prod mapping report has `Catalog found: yes` and `Missing categories: 0`.
6. AdminGateway token passes the `CatalogImport` policy (`super-admin`, `full-access`, `catalog-manager`, or `catalog:import`).
7. The generated import is dry-run validated through local AdminGateway over VPN.
8. User explicitly approves `--apply --yes`.

## First Import Commands

```bash
node scripts/thetea/fetch-snapshot.js --snapshot=thetea-2026-06-02 --langs=all --field-langs=all --concurrency=4 --resume
node scripts/thetea/fetch-prod-reference.js --snapshot=prod-2026-06-02
node scripts/thetea/generate-import.js --snapshot=thetea-2026-06-02 --out=import/thetea/thetea-2026-06-02 --packages=standard --catalog-ref=sources/prod/catalog-reference/prod-2026-06-02.json
node scripts/thetea/import-generated.js --snapshot=thetea-2026-06-02 --profile=categories
node scripts/thetea/fetch-prod-reference.js --snapshot=prod-2026-06-02-after-categories
node scripts/thetea/validate-generated.js --dir=import/thetea/thetea-2026-06-02 --report=thetea-2026-06-02-prod-map --catalog-ref=sources/prod/catalog-reference/prod-2026-06-02-after-categories.json
node scripts/thetea/import-generated.js --snapshot=thetea-2026-06-02
```

Apply command, only after approval:

```bash
node scripts/thetea/import-generated.js --snapshot=thetea-2026-06-02 --apply --yes
```
