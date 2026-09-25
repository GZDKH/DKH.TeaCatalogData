# Design

`reconcile-source-definitions.js` consumes immutable field and category
matrices plus an optional current ProductCatalog reference. It emits every
section field, non-section leaf, migration row and category disposition,
including live IDs, type/unit conflicts, route-to-content decisions and
preservation rules. It treats category definition, catalog-category link,
product membership and effective templates as separate projections.

No operation is applied. A rename candidate preserves the current ID and is
eligible only for a later supported ID-addressed SetupTool operation. Missing
definitions and categories are reported as `add-review`; they are never
created by this command. Existing groups, options, product attributes and
variants remain preserved unless a later reviewed migration explicitly binds
them.
