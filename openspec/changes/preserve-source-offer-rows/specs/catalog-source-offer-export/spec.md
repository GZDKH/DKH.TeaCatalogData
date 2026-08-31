# catalog-source-offer-export Specification

## ADDED Requirements

### Requirement: Supplier source rows are preserved separately from sellable grouping

The source-offer export for a supplier price-list snapshot MUST preserve one
row per source price-list line even when ProductCatalog sellable preparation
groups multiple source rows into one physical sellable identity.

#### Scenario: Duplicate fixed-package prices are exported as separate rows

- **GIVEN** a supplier snapshot has two rows with the same grade label and exact
  500 g package but different package and per-kg prices
- **WHEN** the source-offer bundle is built
- **THEN** the bundle contains two source positions with distinct row numbers,
  client references, reference price observation keys and price amounts
- **AND** both positions may point at the same sellable code hint

#### Scenario: ProductCatalog sellable preparation remains grouped

- **GIVEN** the same supplier snapshot is normalized for ProductCatalog
  preparation
- **WHEN** exact physical candidates are calculated
- **THEN** duplicate grade/package rows remain grouped into one exact sellable
  candidate
- **AND** the duplicate source observations remain visible on that candidate

### Requirement: Source-offer export does not publish seller authority

The source-offer export MUST keep supplier price-list rows as source-reference
data until an authenticated commerce operator separately approves mappings and
sell-side materialization.

#### Scenario: Price-list rows stay non-orderable without commercial approval

- **GIVEN** a source row has CNY package or per-kg prices
- **WHEN** the bundle is built
- **THEN** those amounts are exported as source reference prices and generic
  source facts
- **AND** the bundle does not include seller cost, margin, stock, fulfilment or
  direct-order authority

#### Scenario: Incomplete sale quantity rows remain visible but request-only

- **GIVEN** a source row only provides a by-weight variant or lacks an exact
  package price
- **WHEN** the bundle is built
- **THEN** the row is preserved with diagnostics
- **AND** the row is marked so a storefront offer cannot be published as
  orderable from that row alone
