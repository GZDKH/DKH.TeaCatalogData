# Design

The existing publisher has the right durable apply model: immutable plan,
exclusive apply lock, append-only attempts, idempotency keys, and terminal
receipts. The defect is the target scope. Replacing the whole publisher would
risk losing those safety properties, so the change adds a second transport
behind the same `publishCanary` flow.

The REST transport accepts:

- AdminGateway origin (`--admin-url` / `ADMIN_GATEWAY_REST_BASE_URL`)
- selected storefront code (`--storefront-code`)
- selected catalog code (`--catalog-code`)
- bearer token from `ADMIN_GATEWAY_ADMIN_TOKEN`

Before the transport is created, the tooling resolves the selected codes via
AdminGateway `GET /api/v1.0/storefronts` and `GET /api/v1.0/catalogs`. The
catalog lookup uses the matched storefront's workspace header when available.
Resolution fails unless each code has exactly one match. Direct
`--storefront-id` and `--catalog-id` inputs remain available only as a reviewed
diagnostic fallback.

It sends `command.idempotencyKey` as the `Idempotency-Key` header because the
AdminGateway facade creates mutation control from HTTP headers. The JSON body
therefore contains only public import DTO fields and the item observation DTO.

For REST mode the publication envelope is bound to
`targetScope.kind = storefront-catalog`, `storefrontId`, and `catalogId`.
It does not contain `participantId` or `commerceChannelId`. Legacy gRPC mode is
unchanged and still requires those explicit IDs because the underlying gRPC
contract requires them.

Receipts now support two contract identities:

- `transport: grpc`, preserving proto/service/method closure evidence.
- `transport: admin-rest`, storing AdminGateway API version and scoped route
  template.

Both modes continue to bind target endpoint/TLS mode, source, selected item,
semantic digest, reference price digest, attempt chain, and latest pointer
before any remote mutation.

The TheTea Shop Tieguanyin operator now has a separate retail-price publication
phase behind `--publish-retail-prices`. The existing placement import remains
request-only by default. When the flag is present, the operator resolves the
current CNY currency authority through AdminGateway, builds a dry-run
retail-price plan from the reviewed source fixture, and applies prices through
ProductCatalog's released `SetCatalogSellableRetailPrice` gRPC method only after
`--apply --yes`.

The plan is intentionally catalog-sellable scoped:

- Every row must already have a visible `CatalogSellable` in
  `CATALOG-CHINESE-TEA-SHOP`.
- The retail price basis is the exact 500 g sellable unit.
- One current retail price is published per unique exact sellable.
- Duplicate source price observations for the same grade/package stay visible
  in the plan as duplicate observation counts; they are not silently converted
  into multiple sell-side prices because the ProductCatalog authority model has
  one current retail price per catalog sellable.
- Exact 500 g rows with only a per-kg source amount derive their package amount
  from the source per-kg price and mark that provenance in the plan.

Apply writes a dedicated `retail-price-receipt.json` with read-back evidence and
never stores bearer material or production GUIDs in the public plan. If the same
run created placements, the private rollback manifest is refreshed with the new
placement authority versions after each price revision so placement rollback
does not fail only because retail price publication advanced the placement
version.
