## ADDED Requirements

### Requirement: Aggregate price narrative is review-only

The source-backed proposal builder MUST classify
`/sections/price_counterfeit/price_category` as `review` when the baseline does
not already contain the corresponding specification.

#### Scenario: Missing price category

- **WHEN** a source card supplies `price_counterfeit.price_category` and the
  baseline has no matching attribute
- **THEN** the proposal contains one review item with reason
  `non-product-specific-narrative`
- **AND** the proposal is ineligible for apply
- **AND** the desired product payload does not add that specification
- **AND** the review item retains the source pointer and source hashes.
