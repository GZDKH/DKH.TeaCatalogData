# TheTea source completeness

The TheTea acquisition snapshot must preserve the source inventory before any
ProductCatalog projection. The source exposes teas and infusions through
different projections, and a card can disagree with the inventory row. The
snapshot now records the entity classification, all requested locale attempts,
card language identity, source-contract hashes and per-field coverage without
turning missing or paid locales into English data.

This extends the existing `portable-tea-data-package` acquisition contract. It
does not authorize production import or create products for categories or
infusions.
