# Design

The source snapshot now has two explicit downstream projections:

- ProductCatalog physical preparation: 25 unique exact 500 g sellable
  candidates, still grouped by grade/package identity.
- CommerceNetwork source-offer import/export: 36 immutable supplier rows, one
  row per source price-list line, each with a stable client reference,
  reference prices, mapping hints, public grade/package terms, and diagnostics.

This keeps the catalog model usable for product structure while preserving the
commercial source data needed by the admin workflow. Duplicate fixed-package
rows intentionally share the same sellable code hint but have different
`clientReference`, `rowNumber`, reference price keys, price amounts and row
digests. That gives the later materialization UI enough information to approve
one, many, or none of the supplier offers for the same product position.

The bundle uses the released AdminGateway source-offer DTO. It stores CNY
amounts as source reference prices because the data repo does not own currency
GUIDs or authority versions. `offerTerms` remain text/visibility metadata only.

Rows with no exact package or no package price are preserved as request-only
source rows. That lets the operator see and map the data without accidentally
publishing an orderable storefront offer.
