# Tea product-creation template

`templates/tea.v1/product-creation-template.json` is the repository-side configuration for creating a tea product with the existing generic ProductCatalog model. It is a preparation artifact, not a `tea.v1` runtime type, database seed, service endpoint, or second import format.

The descriptor selects the ordinary `products` DataExchange profile and points to existing definitions by stable code. It never creates a specification group, specification attribute, option, product attribute, package, counterparty, variant combination, or sellable unit. If a required code is absent from the authenticated catalog/category reference, validation stops and the operator resolves that reference first.

The template supplies only safe common defaults: `published=false`, `order=0`, empty optional collections, and no price, producer, manufacturer, year, rating, package, category, or variant value. Product code, translations, and catalog/category assignment remain product-specific inputs. `categoryCode` is deliberately `null` until a current ProductCatalog export supplies the actual existing category code. Package codes are listed as accepted import conventions; they do not assert that those offers currently exist.

Specification definitions are generated from `profile.json`. All fields are optional and omit when the source has no value. Numbers, durations, booleans, dates, ranges, lists, and controlled options remain typed. Dynamic recipe, harvest, and sensory keys use the same stable code patterns. There are no specification defaults, so one product cannot silently copy a producer, harvest year, price, rating, or tasting observation into another product.

The descriptor declares data-driven sections:

- `flavor-wheel` activates only when organoleptic, sensory, or flavor-tag values exist.
- `brewing-table` activates only when brewing or recipe values exist.
- `origin-map` activates only when origin or terroir values exist.
- `product-reading` activates only when profile/classification/harvest values exist.
- `product-review-form` and `product-reviews-list` belong to ReviewService and are enabled by the review-session capability, not by catalog facts.

The review boundary is explicit: a structured tasting session is private by default and becomes public only through an explicit share action. Aroma, flavor, body, mouthfeel, aftertaste, intensity, recommendation, note, and rating are user observations. They never overwrite product specifications.

`examples/yueyang-huangcha.from-post.json` is the first source-backed example. It preserves the article's distinct gongfu, western, and general preparation values instead of averaging them. It records China/Hunan/Yueyang, March-April harvest with April peak, and yellow-tea classification. Producer, year, package, category, and current offers remain unset pending fresh references. `examples/xihu-longjing.from-post.json` proves that the same definitions can be reused with different values.

The safe application sequence is resolve existing references, validate the neutral export, run DataExchange validation, review the diff, apply a one-product canary, read back the product, and re-export it. The descriptor is marked `applyAllowed=false` and requires authenticated references; this repository checkout does not contain production credentials or current catalog IDs.
