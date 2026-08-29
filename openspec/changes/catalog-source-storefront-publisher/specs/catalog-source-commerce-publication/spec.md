# catalog-source-commerce-publication

## ADDED Requirements

### Requirement: Storefront Catalog Scoped Publication

The catalog-source publication CLI SHALL support an AdminGateway REST transport
that targets a selected storefront catalog and does not require raw
CommerceNetwork participant or channel identifiers.

#### Scenario: REST scope resolves from business codes

- **WHEN** the operator runs the publisher or prepared bundle importer with
  `--storefront-code`, `--catalog-code`, and `--admin-url`
- **THEN** the tooling SHALL resolve the storefront and catalog GUIDs through
  AdminGateway before opening an import
- **AND** it SHALL fail closed unless each code matches exactly one record
- **AND** the normal code-based path SHALL NOT require the operator to provide
  raw CommerceNetwork participant/channel IDs or internal storefront/catalog
  GUIDs.

#### Scenario: REST dry-run binds storefront catalog scope

- **WHEN** the operator runs the publisher with resolved storefront/catalog
  scope from business codes or reviewed fallback GUIDs
- **THEN** the generated publication envelope SHALL contain storefront/catalog
  target scope
- **AND** the envelope SHALL NOT contain `participantId` or
  `commerceChannelId`.

#### Scenario: REST apply uses AdminGateway mutation headers

- **WHEN** the operator runs the publisher with `--storefront-id`,
  `--catalog-id`, `--admin-url`, `--apply`, and `--yes`
- **THEN** the publisher SHALL call the AdminGateway storefront/catalog scoped
  begin, item, and commit routes
- **AND** each mutation SHALL send the deterministic idempotency key in the
  `Idempotency-Key` header
- **AND** request bodies SHALL NOT contain `participantId`,
  `commerceChannelId`, or `command`.

#### Scenario: REST receipt records scoped contract identity

- **WHEN** a REST apply reaches a commit acknowledgement
- **THEN** the durable receipt SHALL record the sanitized AdminGateway endpoint,
  TLS mode, API version, and scoped route template
- **AND** it SHALL NOT record raw participant/channel identifiers, request
  bodies, responses, or bearer token material.

#### Scenario: full REST bundle apply verifies prepared chunks

- **WHEN** the operator runs the prepared bundle importer with `--full --yes`
- **THEN** the importer SHALL verify the bundle manifest chunk hashes before
  making any AdminGateway request
- **AND** it SHALL import every selected item through the same
  storefront/catalog scoped routes
- **AND** its receipt SHALL NOT contain bearer token material or raw
  CommerceNetwork participant/channel identifiers.

### Requirement: Selected Source Rows Can Publish Retail Price Authority

The catalog-source storefront operator SHALL provide an explicit, audited step
that publishes ProductCatalog retail-price authority for reviewed source rows
after exact catalog sellables exist.

#### Scenario: retail price dry-run requires curated catalog sellables

- **WHEN** the operator runs with `--publish-retail-prices`
- **THEN** it SHALL resolve CNY currency authority through AdminGateway
- **AND** it SHALL fail closed if any selected source row lacks a visible
  catalog sellable in the target catalog
- **AND** it SHALL write a retail-price plan without bearer token material or
  production GUIDs.

#### Scenario: retail price apply uses ProductCatalog authority

- **WHEN** the operator runs with `--publish-retail-prices --apply --yes`
- **THEN** it SHALL call ProductCatalog `SetCatalogSellableRetailPrice` for each
  selected row whose current retail price is missing or stale
- **AND** it SHALL use the exact 500 g sellable unit as the price basis
- **AND** it SHALL verify read-back before writing the receipt.

#### Scenario: duplicate source prices remain auditable

- **WHEN** multiple source rows map to the same exact grade/package sellable
- **THEN** the retail-price plan SHALL expose the duplicate observation count
- **AND** it SHALL publish at most one current retail price for that
  ProductCatalog catalog sellable.

### Requirement: Legacy gRPC Publication Compatibility

The catalog-source publication CLI SHALL keep the existing gRPC transport for
explicit low-level diagnostics.

#### Scenario: legacy gRPC still requires CommerceNetwork scope

- **WHEN** the publisher is run without storefront/catalog scope
- **THEN** it SHALL require `--participant-id` and `--commerce-channel-id`
- **AND** gRPC apply SHALL still require `--grpc-url`.
