## Purpose

Provide predictable producer metadata so storefront filters expose meaningful shopper choices with localized labels while retaining source facts for product details and future review.

## ADDED Requirements

### Requirement: Shopper filter eligibility is explicit

The generated specification definitions SHALL mark an attribute filterable only when its normalized semantic key is in the producer's shopper-relevance policy and its type is supported by the catalog filter contract. Type alone SHALL NOT make a technical, source, recipe, duration, list, or Boolean field a shopper filter.

#### Scenario: Recipe measurements stay detail-only

- **WHEN** a product contains recipe temperature, steep duration, maximum infusion, or rinse specifications
- **THEN** the generated definitions mark those attributes `filterable: false` and preserve their product values for detail rendering

#### Scenario: Curated categorical choices remain available

- **WHEN** a product contains Tea Type, leaf shape, processing, roast level, caffeine level, brewing difficulty, or price tier
- **THEN** the generated definitions mark only the policy-approved supported categorical attributes `filterable: true`

#### Scenario: Unsupported types are not silently downgraded

- **WHEN** a specification is `Range`, `List`, `Duration`, `Date`, text, or HTML and is not explicitly supported by the policy
- **THEN** it remains non-filterable and is retained with its declared type

### Requirement: Labels never expose raw identifiers

Definition and value translations SHALL use a deterministic canonical English fallback, curated translations where available, and a stable human-readable fallback for unknown semantic keys. A raw definition code or semantic key SHALL NOT be emitted as a user-facing label.

#### Scenario: Missing locale uses English fallback

- **WHEN** a required locale has no curated translation
- **THEN** the generated translation uses the canonical English label and records the fallback locale in localization summary metadata

#### Scenario: Missing source name is humanized

- **WHEN** an imported observation lacks a source name but has a valid semantic key
- **THEN** the generated label is human-readable and does not equal the `SPEC-*`, `TAG-*`, or dotted semantic identifier

### Requirement: Tag namespaces preserve semantic meaning

General taxonomy tags and flavor tags SHALL retain separate stable code namespaces and SHALL never be emitted under the other namespace. Tag labels SHALL be localized from the source card when available and use a deterministic English fallback otherwise.

#### Scenario: General tag is not flavor

- **WHEN** a source card contains a general tag and a flavor tag with the same display text
- **THEN** the generated product contains distinct `TAG-TT-*` and `TAG-FLAVOR-*` codes and no cross-namespace duplicate is created

#### Scenario: Localized tag fallback is deterministic

- **WHEN** a localized card omits a tag label
- **THEN** the generated tag uses the canonical English label for that stable code and never exposes the raw tag code
