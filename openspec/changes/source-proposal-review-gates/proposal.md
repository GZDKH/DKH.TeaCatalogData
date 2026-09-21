## Why

Source-backed fill-missing reconciliation must not turn narrative that covers
several products into a fact of the one product being updated. The tea source's
`price_category` field is an example: it describes a range across multiple
Yueyang teas and has no product-specific price evidence.

## What Changes

- Keep the source field and its evidence in the proposal output.
- Route the known non-product-specific price narrative to the existing review
  queue instead of adding it to the desired product payload.
- Preserve the existing fail-closed eligibility rule: a review item makes the
  proposal ineligible for production apply.

## Impact

Only source-backed proposal preparation changes. Product schemas, definitions,
imports, storefront sections, and the existing supported exchange flow remain
unchanged. An operator may still review the evidence and decide on a separate,
product-specific data correction.
