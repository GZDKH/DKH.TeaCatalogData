## Purpose

Allow API-only complete acquisition of every advertised locale with transparent field provenance and independently counted source reference coverage.

## ADDED Requirements

### Requirement: Acquire every card field transparently
Per-field endpoints MUST remain the default. The explicit card-sections mode MUST retain the complete canonical API card, its SHA-256 and every expected field leaf as acquisition evidence. It MUST NOT claim that endpoint responses were fetched. API request parameters MUST use the metadata source code while retaining its BCP47 locale in snapshots and outputs; resume MUST NOT reuse obsolete request mappings. Locale aliases zh and zh-CN MUST be accepted as the documented same locale without accepting English or another Chinese locale as fallback.

#### Scenario: Canonical API card acquisition
- **WHEN** card-sections mode captures a valid localized card
- **THEN** every section field is retained in that raw card and counted in field coverage
- **AND** generation verifies its source-file hash before using those fields

#### Scenario: Unrelated locale returned
- **WHEN** a Chinese request receives an English or zh-TW card
- **THEN** the source manifest records an error and current production generation is rejected

### Requirement: Count complete API reference inventories
Glossary acquisition MUST use documented offset pagination and places acquisition MUST use documented kind and q filters. The combined unique inventories MUST match each metadata category or kind count. Capped pages MUST remain raw evidence and MUST NOT by themselves qualify as complete. Conflicting repeated identities or count gaps MUST fail qualification.

#### Scenario: Places census matches metadata
- **WHEN** overlapping filtered places responses collectively contain the exact unique count for every advertised kind
- **THEN** their retained raw files qualify the complete reference coverage

#### Scenario: Missing reference records
- **WHEN** any reference count is lower than its metadata count
- **THEN** the source retains a coverage error and cannot generate a current production artifact

### Requirement: Fail visibly on source errors
The source command MUST return a failing exit status when its manifest contains acquisition errors. Current production generation MUST reject such a manifest.

#### Scenario: Exhausted API retries
- **WHEN** a required request fails after its retry policy
- **THEN** the command exits unsuccessfully and preserves the source error

### Requirement: Preserve documented similarity absence
A similarity route 404 defined as no vector MUST be retained as raw absence evidence rather than a fatal capture error. Resume MUST reuse its recorded status; other unexpected similarity failures MUST remain fatal.

#### Scenario: New article has no vector
- **WHEN** the source similarity route returns its documented 404
- **THEN** the snapshot retains the status and body in its hashed file inventory
- **AND** no similar-tea relationship is invented
