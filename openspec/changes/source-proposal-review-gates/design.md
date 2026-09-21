## Decision

Use a small source-path review policy in `source-backed-proposal.js`. The policy
is keyed by the canonical source JSON pointer, so it is deterministic and does
not depend on localized prose. When a candidate specification is missing from
the baseline and its pointer is review-only, emit a normal proposal record with
`action: review`, retain source evidence, leave the desired product unchanged,
and make the proposal ineligible through the existing review queue.

## Rejected alternatives

- Silently drop the field: loses evidence and makes operator review impossible.
- Import it as `CustomMarkdownText`: preserves an aggregate claim as a product
  fact and defeats the fill-missing safety contract.
- Add a tea-specific runtime schema: violates the existing portable product and
  definition model.
