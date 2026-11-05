## Purpose

Project complete TheTea source data into the current destination contract while preserving existing product identity and operator-owned catalog data.

## ADDED Requirements

### Requirement: Preserve current product collections and identity
The producer MUST accept complete current exports containing packageBindings, preserve unrelated destination fields and collection entries, and MUST reject retired package, origin and price fields in a current product. Source slug matches MUST preserve existing TEA product codes; ambiguous matches MUST fail.

#### Scenario: Current product refresh
- **WHEN** an existing source slug is refreshed from a complete current baseline
- **THEN** its identity, catalogs, cross-sells and package bindings remain preserved
- **AND** the payload contains no retired commerce fields

#### Scenario: Source country changes
- **WHEN** the source proposes a different country-derived code for an existing unique TEA source slug
- **THEN** the existing product code is used
- **AND** no duplicate product is created

### Requirement: Retain historical replay
The producer MUST retain complete legacy-baseline replay and MUST reject mixed current and legacy baseline records.

#### Scenario: Mixed baseline
- **WHEN** a marked-complete baseline mixes packageBindings and legacy packages contracts
- **THEN** generation fails before artifact publication

### Requirement: Keep current descriptions localized and source-backed
Current product descriptions MUST use localized source enrichment or classification/origin prose when enrichment is absent. They MUST NOT introduce untranslated interface labels. Full source narratives MUST remain available in knowledge sidecars. Historical replay MUST retain its existing description formatter.

#### Scenario: New source card has no enrichment
- **WHEN** a current-contract card contains localized classification and origin prose but no enrichment
- **THEN** the product description contains that source prose without invented labels
- **AND** its full article narrative remains in the knowledge bundle
