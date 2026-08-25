# Design

The existing publisher has the right durable apply model: immutable plan,
exclusive apply lock, append-only attempts, idempotency keys, and terminal
receipts. The defect is the target scope. Replacing the whole publisher would
risk losing those safety properties, so the change adds a second transport
behind the same `publishCanary` flow.

The REST transport accepts:

- AdminGateway origin (`--admin-url` / `ADMIN_GATEWAY_REST_BASE_URL`)
- selected storefront ID (`--storefront-id`)
- selected catalog ID (`--catalog-id`)
- bearer token from `ADMIN_GATEWAY_ADMIN_TOKEN`

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
