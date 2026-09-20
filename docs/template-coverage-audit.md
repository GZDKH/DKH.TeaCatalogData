# Reusable product-template coverage audit

Status: phase 0 audit for `gzdkh/data/DKH.TeaCatalogData#18` and parent
program `gzdkh/agents/DKH.AgentRules#67`.

This document separates the tea repository's source preparation files from the
runtime capability that must be delivered by the existing ProductCatalog
template and DataExchange flows. `templates/tea.v1` is repository data. It is
not a ProductCatalog runtime type, a persisted service registry, or a second
import format.

## Evidence boundary

The audit was performed against these `origin/main` revisions:

| Repository | Revision | Relevant owner |
| --- | --- | --- |
| `DKH.ProductCatalogService` | `538865424e87e548be31bb26d64dd31c1ed1b518` | Product, specification, attribute, variant, package, release and exchange models |
| `DKH.CounterpartyService` | `36e754dec7aee9d8ea6c9fa3cae948dce7308b39` | Counterparty identity and roles |
| `DKH.CustomerService` | `446c4f193e189c07467ac4263ca0f3180f9228f6` | Private product collection ownership |
| `DKH.ReviewService` | `33c4731fc9dc62e7c747f7869c293064de3a6544` | Public rating and typed review specifications |
| `DKH.StorefrontGateway` | `e98c0d9fb0edf1e00d19d617dbdf958e3efd716c` | Product/review projection to storefronts |

The production catalog and authenticated TheTea snapshots were not available
for this audit. Their absence is a canary prerequisite, not a reason to invent
definition IDs or product facts.

## What the tea repository currently provides

`templates/tea.v1/profile.json` currently declares 21 groups and 25 explicit
attributes. The explicit attributes are:

| Existing type | Count | Intended use |
| --- | ---: | --- |
| `Option` | 8 | Stable taxonomy and curated categorical values |
| `CustomText` | 8 | Short source metadata or unresolved narrative values |
| `Range` | 2 | Oxidation and brewing temperature bounds |
| `Boolean` | 1 | GI status |
| `List` | 4 | Flavor tags, season, occasion and food pairings |
| `Number` | 1 | Brewing water temperature |
| `Date` | 1 | Source last-updated date |

The profile also contains dynamic patterns for sensory intensities, recipe
numbers and durations, rinse flags, harvest lists, and narrative section
fields. The narrative pattern is deliberately `CustomMarkdownText`; it must
not be used for temperature, time, intensity, origin, rating, or other values
that the storefront or filters need to calculate. A future typed definition
must replace a specific narrative field only after its unit, scale, cardinality
and source evidence are known.

`templates/tea.v1/product-template.json` is an empty source record with source
identity, product identity, locale slots, catalog/category placeholders and
empty packages/origins/specifications. It does not currently represent a
selectable saved product-creation template. In particular it does not declare:

- built-in product properties and their requiredness;
- specification defaults and units at catalog/category level;
- product attributes, option dictionaries, variant controls or combinations;
- package/release/sellable-unit defaults;
- authorized CounterpartyService references;
- an admin action that applies all of those layers to a new product.

Therefore the repository artifact is a source-backed fill template, while the
requested “Tea” choice in product creation still belongs to the existing
generic ProductCatalog template capability.

## Existing runtime ownership and coverage

| Product layer | Existing owner and path | Current coverage | Decision |
| --- | --- | --- | --- |
| Product identity/translations | `ProductEntity` and product CRUD/data exchange | Code, SKU, MPN, GTIN, native name, transcription, localized name/description | Reuse; unique Yueyang facts are values, not definitions |
| Typed specifications | `SpecificationAttributeEntity`, `ProductSpecificationAttributeEntity`, catalog/category spec templates | Option, text, number, range, list, boolean, date and duration exist; catalog/category defaults merge | Extend only proven gaps; preserve typed values and units |
| Product attributes | catalog/category product-attribute templates and product attribute CRUD | Shared option dictionary, required/filterable/group settings | Reuse; verify apply and exchange coverage |
| Variant controls | `ProductVariantAttribute`, values and combinations | Controls and selected option values exist; combinations carry SKU/GTIN/stock | Reuse; do not claim a template creates sellable combinations until tested |
| Packages | `ProductPackage` and `PackageEntity` | Quantity and unit/code exist | Reuse; “50 g” is a package mapping, not a specification fact |
| Release/origin | `ProductRelease`, `OriginSite`, `ProductOrigin` | Release requires origin site and evidence digest | Reuse; unknown producer/harvest/site remains unset |
| Seller/manufacturer/vendor | `ProductCounterpartyEntity` and CounterpartyService | Brand, Manufacturer, Supplier and Distributor roles; multiple links | Reuse CounterpartyService; no Vendor table or display-name creation in import |
| Private experience | Customer product collection | Product ownership, private notes/rating boundary exists; no structured tasting fields | Extend the existing collection model in a later phase |
| Public review | ReviewService review specifications and score 1–5 | Review specifications exist; export currently omits them | Extend existing ReviewService exchange/validation only when that task starts |

## Proven generic gaps

The following are implementation gaps evidenced by the current code and are
recorded for the next Beads tasks:

1. The specification-template query/apply path drops Date and Duration defaults
   even though the domain supports those values.
2. A product specification currently has one `OptionId`; controlled
   multi-select from TeaDB requires a verified generic representation before a
   list is advertised as selectable.
3. Variant-template application does not prove creation of combinations and
   sellable units. The template must not promise a purchasable variant until
   this graph is tested.
4. `ProductDataExchangeDto` is not the complete related graph for counterparties,
   variants, releases and sellable units. Existing separate exchange channels
   must be exercised before extending any contract.
5. Review form schema currently derives the full catalog template. Public
   tasting observations need a permitted typed subset, and
   `ReviewDataExchangeDto` currently omits stored review specifications.

No gap authorizes a tea-specific entity, a `tea.v1` service contract, implicit
definition creation, or a replacement importer/exporter.

## Yueyang Huangcha acceptance case

The first canary uses `TEA-CN-YUEYANG-HUANGCHA` from
`https://tea.community/ru-RU/products/yueyang-huangcha`.

The source-backed product may fill identity, localized names, tea type,
Yueyang/Hunan/China origin, known article-backed processing and explicitly
supported recipe values. The following remain unset until evidence resolves
them: producer, precise plantation, unsupported harvest year, and any source
scale whose meaning is not documented. An article statement such as `80–85 °C`
must remain a range; it must not be silently reduced to `80`.

The same product is later used to prove: template selection, two products
sharing definitions but not values, typed import/read-back/re-export,
repeat-import idempotence, section rendering, and a private tasting entry.
Personal aroma, flavor, intensity, texture, aftertaste, recommendation and
rating are user-owned observations. They do not overwrite the catalog profile.

## Required next implementation slice

1. Complete the generic audit in ProductCatalog with an executable create-from-
   template test and preserve the matrix above.
2. Fix the Date/Duration default propagation and prove null, zero and false
   values through the existing contract.
3. Add the saved “Tea” configuration in this repository using existing
   definition codes, while keeping product-specific facts out of defaults.
4. Run the Yueyang canary only after fresh authenticated catalog and source
   snapshots are available; compare export, import, read-back and re-export.

The resulting sections may activate only when the selected typed fields have
values. An empty sensory profile must not render an empty tea-only section.
