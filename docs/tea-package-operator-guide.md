# Tea preparation package operator guide

This guide prepares ordinary ProductCatalog products. It does not add a Tea
runtime type, a separate importer, or a dependency on TeaDB. The files under
`templates/product-profiles/tea` are a reusable preparation profile that uses
the existing `products` DataExchange flow.

## 1. Start with an evidence record

Copy `templates/product-profiles/tea/product-template.json` into a local,
untracked working record. Fill the real source system, external ID, source URL,
revision, and retrieval time. Give the product a stable code and its own
translations. Do not copy a source name, price, producer, harvest year, rating,
package, category, or variant from another Tea record.

`examples/yueyang-huangcha.acceptance.json` is the reference outcome. It keeps
only facts that its cited product page proves: yellow-tea type, China/Hunan/
Yueyang, two distinct brewing recipes, and harvest months. Unknown commercial
and production facts are intentionally absent.

## 2. Resolve existing catalog references

Fetch read-only current references with `DKH.SetupTool`; it obtains its
credentials from the existing environment, never from this repository's data
files:

```bash
dotnet run --project workers/DKH.SetupTool/DKH.SetupTool -- \
  --export-references \
  --snapshot=<reference-snapshot> \
  --workspace-id=<product-catalog-workspace-id> \
  --output-root="$PWD/data/DKH.TeaCatalogData/sources/prod" \
  --client-credentials
```

Use the resulting catalog/category/specification/option/package/counterparty
codes. A missing code is a validation stop: create or approve the generic
definition through its owning ProductCatalog workflow first, then refresh the
reference. Do not make up IDs or let an import create a definition.

## 3. Fill typed specifications

Use `field-matrix.json` with the complete 75-definition inventory in
`docs/tea-definition-migration-matrix.json`.

| Data | How to fill it |
| --- | --- |
| Taxonomy and controlled labels | Existing `Option` code only. Unknown option goes to review. |
| Temperature | `Number`/`Range` with `°C`; preserve a range when the source gives one. |
| Tea mass and water volume | `Number` with `g` and `ml`. |
| Steeping interval | `Duration` in seconds. |
| Maximum infusions | `Number` with `count`. |
| Harvest months and tags | `List` using the defined list encoding and validated values. |
| Narrative source text | Do not map it by section name. It needs an explicitly named narrative definition and source evidence. |
| Sensory intensity | Do not import it yet. It is disabled until a source-backed scale contract fixes the dictionary and range. |

Every value is optional unless the existing generic definition says otherwise.
No default is inferred from another Tea, a category, a previous source, or a
user tasting note. The profile rejects unknown fields, units, options, and
scales for review rather than storing them as Markdown.

## 4. Fill the product graph without inventing commerce data

Use ProductCatalog's ordinary product fields, attributes, variants, packages,
releases/origins, and DataExchange profiles. The preparation descriptor leaves
category, product-attribute option, package, sellable combination, and offer
values unresolved until current references prove them.

For brand, manufacturer, supplier, or distributor, reference an existing
CounterpartyService identity by code and role. “Vendor” is not a product text
field and is never created from a display name during import.

## 5. Validate before any write

Run the package checks from `data/DKH.TeaCatalogData`:

```bash
node scripts/thetea/test-portable-product-profile-contract.js
node scripts/thetea/test-template-coverage.js
node scripts/thetea/test-product-creation-template.js
node scripts/thetea/test-definition-migration-matrix.js
node scripts/thetea/test-spec-contract.js
python3 ../../agents/DKH.AgentRules/scripts/openspec.py cli -- validate portable-tea-data-package --strict
```

Generate and validate the ordinary DataExchange artifact with the existing
workflow, supplying both current reference exports:

```bash
node scripts/thetea/generate-import.js \
  --snapshot=<source-snapshot> \
  --out=import/thetea/<artifact-id> \
  --packages=standard \
  --catalog-ref=sources/prod/catalog-reference/<reference-snapshot>.json \
  --product-ref=sources/prod/product-reference/<reference-snapshot>

node scripts/thetea/validate-generated.js \
  --dir=import/thetea/<artifact-id> \
  --report=<artifact-id>-map \
  --catalog-ref=sources/prod/catalog-reference/<reference-snapshot>.json \
  --product-ref=sources/prod/product-reference/<reference-snapshot>
```

The output must retain source identity, existing stable definition codes,
value type, units, and unrelated baseline records. It must report no missing
required references before review.

## 6. Apply and verify separately

Data generation and validation perform no production write. A one-product
canary happens only under the approved DataExchange workflow with explicit
apply confirmation. Read the product back, re-export it, compare types/units/
options/source identity, then request separate approval for any larger import.

Storefront sections and private tasting notes are later consumers of the same
typed ProductCatalog data. They do not change the preparation package or add
Tea-specific fields to the platform.
