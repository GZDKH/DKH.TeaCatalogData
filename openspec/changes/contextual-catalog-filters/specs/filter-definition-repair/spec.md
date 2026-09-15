## Purpose

Allow operators to review and safely repair existing catalog filter metadata through the supported AdminGateway API without overwriting custom catalog settings or unrelated definitions.

## ADDED Requirements

### Requirement: Repair is scoped and idempotent

The repair manifest SHALL compare stable definition codes, change only the allowlisted filterability and missing-translation fields, report create/update/no-op/conflict operations, and leave unrelated definitions and operator-owned fields unchanged. Re-running against the repaired reference SHALL produce no updates.

#### Scenario: Custom definition fields are preserved

- **WHEN** an existing definition has a custom order, publication state, or translation not targeted by the repair policy
- **THEN** the desired payload retains those fields exactly and the diff lists only targeted fields

#### Scenario: Unrelated definitions are excluded

- **WHEN** a catalog reference contains definitions outside the producer-managed semantic scope
- **THEN** they are absent from the repair payload and rollback payload

#### Scenario: Conflicting ownership blocks apply

- **WHEN** a target definition is missing, duplicated, or differs in an immutable identity field
- **THEN** the manifest reports a conflict and the supported API apply path is not eligible

### Requirement: Dry-run and rollback are reviewable

The repair command SHALL default to read-only dry-run mode, emit a machine-readable diff and exact pre-change rollback payload, and require the existing explicit validate/import confirmation flags for any remote operation.

#### Scenario: Dry-run produces no production write

- **WHEN** the command is run without `--apply --yes`
- **THEN** it writes only the scoped local report and rollback artifacts and performs no production mutation

#### Scenario: Apply failure attempts rollback

- **WHEN** a reviewed apply fails after a partial update
- **THEN** the command attempts the exact rollback payload through the same supported API and records rollback success or failure
