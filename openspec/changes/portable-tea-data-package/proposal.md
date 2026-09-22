## Why

The checked-in Tea preparation files currently identify `my.teadb.org` as their
default source and contain storefront section instructions. That makes a
portable product-data template look like a TeaDB integration and lets catalog
data control a theme. The merchant needs a source-neutral, typed package that
uses the existing ProductCatalog DataExchange contract.

## What Changes

- Move the Tea preparation files from `templates/tea.v1/` to the neutral
  `templates/product-profiles/tea/` location.
- Remove the profile-level default source and all section/render metadata.
- Require every example record to identify its actual evidence source, while
  keeping stable ProductCatalog group, attribute, option and DataExchange
  codes unchanged.
- Update repository tests and operator documentation to use the new location
  and to state the data-versus-theme boundary.

## Capabilities

### New Capabilities

- `portable-tea-preparation-package`: source-neutral Tea preparation files
  that produce ordinary ProductCatalog import data without theme bindings.

### Modified Capabilities

- None.

## Impact

Affected repository paths are the Tea profile, envelope schema, fillable and
example data, template-coverage tests, and operator documents. ProductCatalog,
StorefrontService, Admin UI, ReviewService and production data are not changed
by this phase. Discovery selected **fix** for the package contract and
**integrate** for the existing DataExchange path. Evidence includes
`templates/tea.v1/profile.json`, `scripts/thetea/test-template-coverage.js`,
and GitLab issue `gzdkh/data/DKH.TeaCatalogData#26`.

Non-goals: no TeaDB API/export integration, no new runtime tea type, no new
importer, no definition creation, no production write, and no theme migration.
