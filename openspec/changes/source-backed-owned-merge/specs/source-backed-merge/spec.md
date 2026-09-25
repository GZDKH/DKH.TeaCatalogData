## Purpose

Prepare source-backed updates without overwriting manual destination changes.

## ADDED Requirements

### Requirement: merge source-owned fields with a stable identity
The proposal MUST identify a source record by provider system, external ID and
entity kind, and MUST merge translations, source-managed specifications, tags
and origins using stable keys.

#### Scenario: unchanged destination accepts a source update
- **WHEN** the current specification equals the last applied source and the
  incoming source changes its value
- **THEN** the proposal applies the incoming value and keeps the product ID,
  price, publication state and package/variant data unchanged

### Requirement: manual destination drift becomes a conflict
The proposal MUST preserve a current destination value when both the source and
destination changed since the last applied source, and MUST emit a review
record with reason `three-way-conflict`.

#### Scenario: manual specification edit conflicts with source refresh
- **WHEN** the current specification differs from the last applied source and
  the incoming source also differs
- **THEN** the desired product keeps the current specification
- **AND** the proposal is ineligible until the conflict is reviewed
