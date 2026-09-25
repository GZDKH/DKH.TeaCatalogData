# Source-backed fill-missing proposals

`prepare-source-proposal.js` prepares a review artifact from one immutable source card and one complete ProductCatalog export. It reuses the existing `products` DataExchange shape; it does not add a tea-specific runtime profile, database seed, service endpoint, or external integration.

```bash
node scripts/thetea/prepare-source-proposal.js \
  --source-card=/path/to/raw/cards/en/yueyang-huangcha.json \
  --source-manifest=/path/to/manifest.json \
  --field-pack=/path/to/raw/d1/field-packs/yueyang-huangcha.json.gz \
  --product-ref=/path/to/product-reference/prod-products-<snapshot> \
  --article-url=https://tea.community/ru-RU/products/yueyang-huangcha
```

The command is read-only and writes `proposal.json`, `proposals.json`, `desired-products.json`, and `rollback-products.json` under `reports/thetea/source-proposals/<slug>/`. If a D1 field pack is supplied, its locale rows are overlaid with the same field-details normalizer used by the regular generator, and its hash is included in the stale-input gate. A proposal records the exact product code, article URL, source snapshot, card version and last-updated revision, source and baseline hashes, and a JSON Pointer plus excerpt for each source-backed value.

The fill-missing policy is conservative:

- a missing specification, tag, translation, or origin member is proposed for addition;
- an existing value is retained, including `0` and `false`;
- a different existing value is placed in `reviewQueue` and never silently replaced;
- duplicate recipe, harvest, or sensory discriminators with different payloads are review-only conflicts;
- a complete source range cannot replace a baseline range with a missing bound; that case is reported as `range-truncation`;
- product matching is exact by ProductCatalog code derived from the source country and slug; fuzzy names never select a baseline.

When a previous applied product is available, pass it as `sourceMetadata.lastAppliedProduct`.
The proposal then records a provider-independent identity (`source system`, external ID and
entity kind) and applies a three-way merge to source-owned translations, tea specifications,
tea tags and origins. A destination value is updated only when it still equals the previous
source value. A destination edit made after that source application is retained and reported
as `three-way-conflict` for review. Product ID, price, stock, publication state, packages,
variants and unrelated collections remain from the complete destination baseline.

`desired-products.json` contains the complete nested product payload required by the existing replace-mode exchange. `rollback-products.json` contains the exact baseline product for every update. The payloads are empty when there is no change or when review is required. Before any later apply step, the recorded source and baseline hashes must still match; a changed input is stale and must be prepared again.

The sample Yueyang card currently produces 30 unchanged source observations and no write proposal against the captured baseline. This is an expected result: the mechanism proves completeness without overwriting the current product.
