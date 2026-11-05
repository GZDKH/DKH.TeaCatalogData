## Purpose

Keep encyclopedia category articles distinct from tea products and prepare their complete localized content for the existing native SetupTool knowledge import.

## ADDED Requirements

### Requirement: Route category articles separately
The producer MUST capture the category inventory and cards separately, retain source Markdown and available locale evidence, and prepare category articles as knowledge content rather than products.

#### Scenario: Category article in source inventory
- **WHEN** an entity has kind category
- **THEN** it appears in the hash-bound topic inventory
- **AND** it does not appear in the product inventory

### Requirement: Prepare bounded native content records
Content preparation MUST verify artifact and source/reference hashes, support exact entity selection, and create native records without a production write. Preparation MUST require scoped full destination article reads or explicit verified absence for every selected article. Existing publication state, cover and unrelated translations MUST be preserved. New topic records MUST default to draft unless publication is explicitly requested.

#### Scenario: One topic selected
- **WHEN** an operator prepares one exact topic slug
- **THEN** only that topic's native content record is emitted with source and output hashes
- **AND** no product or production mutation occurs
