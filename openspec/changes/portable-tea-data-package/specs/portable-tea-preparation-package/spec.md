## Purpose

Provide a reusable Tea preparation package that can be validated and converted
to ordinary ProductCatalog DataExchange data without tying the platform to a
source website or a storefront theme.

## ADDED Requirements

### Requirement: Source-neutral Tea preparation package
The repository SHALL publish the Tea preparation package under a
product-profile path. The package MUST not declare a default external source.
Every concrete product example MUST identify its own evidence source and
revision.

#### Scenario: Fillable product record
- **WHEN** an operator starts a new Tea product from the fillable template
- **THEN** the record requires placeholders for the actual source identity and
  does not identify MyTeaDB as a default source

#### Scenario: Source-backed acceptance record
- **WHEN** validation reads the Yueyang Huangcha fixture
- **THEN** it finds the fixture's actual source, revision, and product identity
  without adding a source-specific runtime requirement

### Requirement: Data-only package boundary
The Tea preparation package SHALL contain ProductCatalog data mappings only.
It MUST NOT contain storefront section identifiers, render activation rules,
or user-facing theme copy.

#### Scenario: Theme-independent validation
- **WHEN** the profile and creation descriptor are validated
- **THEN** validation rejects a section/render binding and accepts stable
  ProductCatalog codes, types, units, and options

### Requirement: Existing DataExchange compatibility
The package SHALL retain the existing DataExchange envelope and stable catalog
definition codes. It MUST reject instructions to create definitions during an
ordinary product import.

#### Scenario: Existing-code import preparation
- **WHEN** an operator converts a validated Tea record for import
- **THEN** it references existing groups, attributes, options, variants, and
  counterparties by stable identity and does not generate new definitions
