## Purpose

Make source-language to destination-culture mapping explicit and repeatable.

## ADDED Requirements

### Requirement: resolve all source languages through a versioned policy
The policy MUST contain all 72 source languages and MUST select destination
cultures from the supplied destination registry.

#### Scenario: one source language has several destination cultures
- **WHEN** English or German has multiple selected cultures
- **THEN** one source record maps to each selected target with explicit derivation

### Requirement: distinguish native and inherited content
The coverage report MUST mark exact source-locale content as native and copied
language content as inherited-language.

#### Scenario: inherited English content
- **WHEN** English content is materialized into en-GB
- **THEN** the row is not reported as a native en-GB translation

### Requirement: fail closed on uncertain locale semantics
Unknown cultures, unavailable destinations, script ambiguity and tl/fil aliasing
MUST remain review-required, while zh-CN, zh-HK and zh-TW remain distinct.

#### Scenario: unavailable destination culture
- **WHEN** no candidate culture exists in the destination registry
- **THEN** the source mapping is review-required and no fallback locale is invented
