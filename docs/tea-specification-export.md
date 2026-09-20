# Tea specification export profile

`templates/tea.v1/profile.json` is the data contract for exporting tea facts from an external source such as `my.teadb.org`. It is deliberately stored with catalog data rather than in a storefront theme. A future `coffee.v1` or `ceramics.v1` profile can use the same envelope and generic ProductCatalog DataExchange path.

The exporter writes `templates/tea.v1` records. The profile maps its stable semantic keys to the existing ProductCatalog codes. The resulting Admin DataExchange artifact keeps the current layout:

| Export profile | ProductCatalog artifact |
| --- | --- |
| `groups[].targetCode` | `02-specifications/specification_groups.json` |
| `attributes[].targetCode` | `02-specifications/specification_attributes.json` |
| option values | `02-specifications/specification_attribute_options.json` |
| `record.product` and mapped `record.specifications` | `04-products/<category>/<product-code>.json` |

The export envelope carries source identity and revision separately from the ProductCatalog product. The converter must use `(source.system, source.externalId)` as an idempotent upsert key, preserve `source.revision` as provenance, and map only known profile keys. Unknown groups or attributes fail validation; they must not create ad-hoc fields that the storefront cannot render consistently.

ProductCatalog values use the existing representation: `Option` uses an option code, `List` uses a JSON array encoded as a string, `Number`, `Boolean`, `Date`, `Duration`, and text types use `value`, and `Range` uses `valueMin`/`valueMax`. A missing source value omits the specification. The `product.specifications` array must contain an attribute at most once.

`organoleptic`, `sensory`, and the `enrichment.flavor_tags` mapping are the initial flavor-wheel inputs. The flavor section activates only when the canonical product has values in one of those groups. A product with no values does not render an empty tea-only section.

The safe operational sequence is:

1. Export records using `schema.json` and the mapping in `profile.json`.
2. Resolve semantic keys to target codes and generate the normal ProductCatalog artifact.
3. Run local validation plus AdminGateway DataExchange `validate` (dry run).
4. Inspect the diff and run a one-product canary with read-back.
5. Apply a larger import only after the canary and source revision checks pass.

This profile does not add a TeaDB dependency to the storefront and does not import personal tasting notes or user ratings. Those are user-owned review data and require a separate privacy/publication contract.
