# Tea specification export profile

`templates/product-profiles/tea/profile.json` is a repository data contract for preparing tea facts for the existing ProductCatalog DataExchange path. It has no external source default and no storefront binding. `product-template.json` is the fillable starting record; `examples/xihu-longjing.from-post.json` is a source-backed product record. Another product profile can use the same envelope without changing a platform service.

The exporter writes `templates/product-profiles/tea` records. The profile maps stable semantic keys to existing ProductCatalog codes. The resulting Admin DataExchange artifact keeps the current layout:

| Export profile | ProductCatalog artifact |
| --- | --- |
| `groups[].targetCode` | `02-specifications/specification_groups.json` |
| `attributes[].targetCode` | `02-specifications/specification_attributes.json` |
| option values | `02-specifications/specification_attribute_options.json` |
| `record.product` and mapped `record.specifications` | `04-products/<category>/<product-code>.json` |

The profile covers metadata-owned fields (tea type, category, oxidation, brew temperature, processing, roast, GI and source state), standard enrichment and organoleptic fields, and typed dynamic recipe, harvest, and sensory fields. It has no section-name fallback. The export envelope carries source identity and revision separately from the ProductCatalog product. The converter must use `(source.system, source.externalId)` as an idempotent upsert key, preserve `source.revision` as provenance, and map only known profile keys. Unknown groups, attributes, options, units, and scales enter review; they must not create ad-hoc fields that the storefront cannot render consistently.

ProductCatalog values use the existing representation: `Option` uses an option code, `List` uses a JSON array encoded as a string, `Number`, `Boolean`, `Date`, `Duration`, and text types use `value`, and `Range` uses `valueMin`/`valueMax`. A missing source value omits the specification. The `product.specifications` array must contain an attribute at most once.

`organoleptic`, `sensory`, and `enrichment.flavor_tags` are typed product data. A storefront theme may independently select those codes for a sensory section; the data package does not name or activate a section.

The safe operational sequence is:

1. Export records using `schema.json` and the mapping in `profile.json`.
2. Resolve semantic keys to target codes and generate the normal ProductCatalog artifact.
3. Run local validation plus AdminGateway DataExchange `validate` (dry run).
4. Inspect the diff and run a one-product canary with read-back.
5. Apply a larger import only after the canary and source revision checks pass.

The profile and its generated artifact are the tea repository's responsibility. ProductCatalog and storefront services receive the resulting files as an ordinary product import and do not know that the source was tea or TeaDB. This profile does not add a TeaDB dependency to the storefront and does not import personal tasting notes or user ratings. Those are user-owned review data and require a separate privacy/publication contract.
