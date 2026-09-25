## Purpose

Keep tea definition and category synchronization deterministic and reviewable
before any SetupTool or ProductCatalog write.

## ADDED Requirements

### Requirement: complete field and definition coverage
The reconciliation MUST include all 284 section field pairs, 83 non-section
paths, 89 legacy definition mappings, 210 category definitions and 62 direct
category mappings.

#### Scenario: incomplete matrix is rejected
- **WHEN** an input matrix has a different count
- **THEN** the command fails before producing a report

### Requirement: no implicit definition creation
The reconciliation MUST classify missing live definitions and categories as
review candidates and MUST set `applyAllowed` to false.

#### Scenario: missing live definition
- **WHEN** neither the legacy nor canonical code exists in the supplied live reference
- **THEN** the report emits `add-review` and does not emit an import operation

### Requirement: preserve identity and boundaries
The reconciliation MUST preserve existing IDs for rename candidates and MUST
keep specifications distinct from configurable attributes, variants, category
membership, localized content and provenance.

#### Scenario: canonical collision
- **WHEN** multiple legacy concepts propose one canonical code or live type/unit differs
- **THEN** the report emits `conflict` and no automatic rename or merge
