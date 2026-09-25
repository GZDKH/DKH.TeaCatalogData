## Purpose

Preserve complete TheTea source coverage and contract evidence before any
ProductCatalog projection.

## ADDED Requirements

### Requirement: classify source entities before projection
The snapshot MUST record every discovered tea or infusion row with an entity kind
and evidence. A card-level kind that conflicts with the inventory MUST remain a
reviewable observation and MUST NOT silently become a product.

#### Scenario: infusion inventory disagrees with its card
- **WHEN** `/api/v2/infusions` returns `kuqiaomai` and `/api/v2/tea/kuqiaomai`
  returns `kind=tea`
- **THEN** the manifest records both classifications and the mismatch
- **AND** the slug is excluded from `manifest.slugs` until reviewed

### Requirement: preserve locale and field completeness evidence
The snapshot MUST attempt each requested source locale and each field detail
locale without falling back to English. It MUST record the expected, fetched and
missing field leaves for every usable card.

#### Scenario: locale is outside the subscribed plan
- **WHEN** a card request returns HTTP 402
- **THEN** the manifest retains the status and response body
- **AND** no English card is substituted

### Requirement: retain source contract identity
The snapshot MUST save the source contract payloads and their SHA-256 hashes so
schema drift can be compared across runs.

#### Scenario: contract changes without an API version bump
- **WHEN** `/openapi.yaml` or `/llms.txt` changes
- **THEN** the manifest records the new hash alongside the immutable payload
- **AND** the run remains attributable to the captured contract

### Requirement: emit an immutable leaf disposition matrix
The acquisition tooling MUST emit a hash-bound inventory of each entity,
locale, card attempt and observed source leaf. Every leaf MUST have an explicit
disposition, including review-required or raw-source preservation, and source
reference caps or unsupported routes MUST remain visible gaps.

#### Scenario: capped reference endpoint
- **WHEN** a glossary or places response reaches its documented request limit
- **THEN** the inventory flags the response as possibly truncated
- **AND** the report is ineligible for a complete import until the gap is resolved

#### Scenario: unsupported infusion card route
- **WHEN** `/api/v2/infusion/{slug}` returns 404
- **THEN** the report keeps the status and response body as a source gap
- **AND** it does not substitute `/api/v2/tea/{slug}` for the infusion entity
