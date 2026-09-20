# Authenticated ProductCatalog snapshot — 2026-09-20

This is a read-only evidence record for issue `DKH.TeaCatalogData#14`. The
source was downloaded from the authenticated DKH Admin system import/export
screen for the existing catalog `CATALOG-CHINESE-TEA`. No ProductCatalog,
catalog-template, or product data was written.

The machine-readable manifest is
[`prod-snapshot-2026-09-20.json`](prod-snapshot-2026-09-20.json). The raw
download remains in the ignored snapshot directory
`sources/prod/product-reference/prod-admin-2026-09-20/` so it can be used for
local replay without placing an 80 MB production export in Git.

## Source and completeness

- Host: `admin.xnata.com`
- Page: `/ru-RU/catalogs/0be5b4fc-651b-4953-87d8-08d976ddb13d/imports`
- Catalog: `Китайский чай` / `CATALOG-CHINESE-TEA`
- Catalog id: `0be5b4fc-651b-4953-87d8-08d976ddb13d`
- Capture evidence: download `products_20260920_221900.json`; the UI showed
  526 products and the downloaded array contains 526 records. The exact server
  event timestamp was not exposed, so the manifest labels the filename-derived
  time as evidence rather than as an API timestamp.
- Workspace label: `XNATA Platform`. The authenticated UI did not expose the
  workspace UUID, so `workspaceId` is deliberately `null`; no historical or
  guessed UUID is used.

## Hashes

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `products.json` | 83,588,306 | `0480b20703257638b6a2925e81270aa5c7de62c2e847ef1b475677a913f89e5f` |
| `products_template.json` | 14,251 | `6691af43c76cc8a387ce410bc9fa5837a98ed4af3ca9cff000d75ccb38dec4f8` |

## Observed data shape

The export contains 526 unique product ids, codes, and SKUs with no duplicates.
Every product has specifications (18,967 rows), tags (3,729), packages
(2,631), catalog placements (3,947), and one origin record. There are 526
related-product links and no cross-sells in this snapshot.

The 18,967 specification rows use eight existing exchange types: `Number`
(6,388), `CustomMarkdownText` (6,377), `Option` (1,574), `Duration` (1,350),
`List` (1,350), `Boolean` (900), `CustomText` (514), and `Date` (514). They
reference 78 distinct attributes and 21 options. The export has 17,393
non-empty scalar values; range columns `valueMin` and `valueMax` are empty in
this snapshot. The existing template exposes 443 columns, including all
`specs.*` fields (`type`, `value`, `valueMin`, `valueMax`, `showOnPage`, and
ordering), so the tea preparation data can continue using the platform's
normal import/export contract.

## Live template observation

Opening the catalog template editor immediately after the export showed:

- `No specifications yet for this catalog.`
- `No variant attributes yet for this catalog.`

This is a configuration gap, not a reason to create a tea-specific runtime
profile. The next controlled phase must resolve the stable existing definition
ids/codes for this catalog, then populate the repository preparation template
and validate imports against those definitions. Unknown fields must remain a
validation/review error; imports must not auto-create definitions.

## Current phase status

The authenticated product export and its hashes are captured. The phase is
still blocked for closure because the workspace UUID required by the normal
ProductCatalog export/validation tooling is not visible in the authenticated
UI. Resolving it requires an authorized API read or an operator-provided
current workspace identifier. No credentials were changed and no production
write was attempted.
