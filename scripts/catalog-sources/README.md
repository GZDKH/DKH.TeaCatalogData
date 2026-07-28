# Public catalog source ingestion

This directory contains one source-agnostic snapshot runtime and small,
reviewed connectors. Adding a source means implementing the fixed connector
interface plus sanitized fixtures. It does not mean creating another service,
adding source-specific code to CommerceNetwork, or accepting JavaScript from an
administrator.

## ZZCTea

Run a complete snapshot of the public HTML hot-tea catalog exposed by
`/teaList`:

```bash
node scripts/catalog-sources/fetch-snapshot.js \
  --source=zzctea \
  --snapshot=zzctea-2026-07-27 \
  --resume \
  --minimum-request-interval-ms=1000 \
  --concurrency=1
```

This is not the larger inventory behind the robots-disallowed `/api/` routes.
The runtime must not describe the HTML subset as the complete ZZCTea inventory
or combine it with an older API snapshot.

The HTML routes being robots-allowed is a transport constraint, not a content
reuse license. Do not run a multi-item live snapshot or copy source images until
source permission/terms, image reuse, and the request-rate limit have been
reviewed. Offline fixtures and replay remain the default verification path.

Replay the exact stored responses without network access:

```bash
node scripts/catalog-sources/fetch-snapshot.js \
  --source=zzctea \
  --snapshot=zzctea-2026-07-27 \
  --replay
```

Project one complete, verified artifact into provider-neutral CommerceNetwork
observation DTOs without making any service or database writes:

```bash
node scripts/catalog-sources/project-artifact.js \
  --artifact-dir=artifacts/catalog-sources/zzctea/zzctea-2026-07-27
```

The projection is written atomically below
`artifacts/catalog-source-projections/<source>/<snapshot>/`. It contains a
content-addressed projection, a deterministic dry-run report, and a manifest
binding both outputs to the input artifact and checkpoint hashes. The loader
rejects incomplete, extra, symlinked, hash-mismatched, deletion-authoritative,
or retail-price-marked input.

Prepare an explicit one-item Commerce observation canary without making a
network call:

```bash
node scripts/catalog-sources/publish-commerce-observations.js \
  --projection-dir=artifacts/catalog-source-projections/<source>/<snapshot> \
  --only=<external-id> \
  --participant-id="$COMMERCE_CATALOG_SOURCE_PARTICIPANT_ID" \
  --commerce-channel-id="$COMMERCE_CATALOG_SOURCE_CHANNEL_ID"
```

Dry-run is the default. It writes a content-addressed plan below
`artifacts/catalog-source-commerce-canaries/`, fixes
`expectedItemCount` to one, selects exactly one external ID, and explicitly
records `authoritativeForDeletion: false`. Plan-generation fields state that
no network call or remote mutation occurred while creating the plan. The
registered source code is always the verified projection `source.id`; it cannot
be redirected to another registration. Dry-run does not construct the gRPC
client, read an admin token, or make a network call.

After the registered source, participant grant, channel, version tuple, and
one-item plan have been reviewed, the same plan can be applied only with both
flags:

```bash
node scripts/catalog-sources/publish-commerce-observations.js \
  --projection-dir=artifacts/catalog-source-projections/<source>/<snapshot> \
  --only=<external-id> \
  --participant-id="$COMMERCE_CATALOG_SOURCE_PARTICIPANT_ID" \
  --commerce-channel-id="$COMMERCE_CATALOG_SOURCE_CHANNEL_ID" \
  --grpc-url="$COMMERCE_NETWORK_GRPC_URL" \
  --apply \
  --yes
```

Apply reads `COMMERCE_NETWORK_ADMIN_TOKEN` only from the child-process
environment. The token is expanded by `grpcurl`, never placed in its argument
list, plan, receipt, or log output. It is trimmed, validated as bearer-token
material, and passed to the child through a normalized environment. Failure
output is fully redacted, including reflected Bearer values and token
fragments, before the diagnostic size limit is applied. TLS is the default;
`--plaintext` is an explicit loopback-only override. The publisher invokes
`BeginCatalogSourceSnapshotImport`, `ImportCatalogSourceItem`, and
`CommitCatalogSourceSnapshotImport` in order and stops immediately on any
failure. Deterministic idempotency keys make a retry safe; a replayed already
committed import is accepted without sending another item or commit. A
successful process exit with malformed JSON produces a fixed error and never
includes parser excerpts from the response. Count and state validation errors
are also fixed and bounded; they never interpolate remote response values.

Before the first RPC, apply atomically creates a durable receipt with
`remoteMutationAttempted: false`, then atomically marks the attempt and updates
the last acknowledged stage, safe IDs, and counts after each successful
Begin/Import/Commit response. A failure leaves a redacted terminal attempt
state, so a partial remote mutation can never be mistaken for the dry-run plan.
The receipt contains neither the token nor raw requests or responses.
Attempts are append-only below
`apply/attempts/attempt-<number>-<deterministic-digest>/`; retry never replaces
an earlier failed or partial receipt. An atomic `apply/latest.json` pointer
contains the current receipt path and digest. Attempt identities bind the
publication, monotonic attempt number, and previous receipt digest; they do not
depend on timestamps. Begin is acknowledged only after its state/counts pass
validation. Commit is recorded in one atomic update that simultaneously marks
the commit and production state acknowledged, avoiding an intermediate
contradictory receipt.

Each audit root is permanently bound by `auditBindingSha256` to one
publication/item/source, target endpoint and TLS mode, complete contract
closure/service/method identity, and required semantic/reference-price
read-back. Every retry verifies that binding, contiguous attempt numbers,
deterministic attempt IDs, the previous-receipt hash chain, and the latest
pointer before creating a new attempt. A custom `--out` therefore cannot mix
two publications into one apply audit root, and tampered history fails before
any new attempt or RPC.

Apply also acquires the exclusive `apply/.apply.lock` before it constructs a
transport, reads attempt history, creates a receipt, or invokes an RPC. The
same owner holds that lock through the terminal receipt and latest-pointer
updates. A concurrent invocation fails closed without changing the attempt
chain. The publisher releases only the lock whose in-memory owner token and
inode still match; it never removes or automatically breaks an existing lock.

A hard process crash can therefore leave both `.apply.lock` and a `prepared` or
`in-progress` receipt. Treat either as an incident requiring explicit operator
recovery: first prove that no publisher still owns the audit root, then
reconcile the receipt with the remote import state and preserve the audit
evidence. Merely restarting the command is intentionally insufficient. Even
after an operator has dealt with a crash lock, the publisher refuses to append
a retry while the latest attempt is non-terminal. Only `failed` and
`commit-acknowledged-read-back-pending` attempts are terminal for retry
purposes; recovery must never rewrite a historical receipt.

A commit-acknowledged apply receipt records whether the commit was new or
replayed, the sanitized endpoint/TLS mode, gRPC service/method identities, and
the SHA-256 of both the root proto and its deterministic transitive closure.
The closure resolver accepts real files only inside the two allowlisted proto
roots, rejects symlinks, path escapes, missing/ambiguous imports and cycles, and
parses imports independently of line layout. It binds sorted logical paths to
each file hash and is revalidated immediately before every RPC. The receipt
stores only closure, file-list, and built-in-import digests/counts, never proto
plaintext.
It deliberately records `complete: false`, `readBackVerified: false`, and
`readBackRequired: true`. The import-only actor has no authorized read RPC, so
the canary is not complete until a later authorized read-back verifies the
registered source, external ID, semantic revision, and reference-price set
against the receipt.

CLI configuration keys:

- `COMMERCE_CATALOG_SOURCE_PARTICIPANT_ID` / `--participant-id`
- `COMMERCE_CATALOG_SOURCE_CHANNEL_ID` / `--commerce-channel-id`
- `COMMERCE_CATALOG_SOURCE_ARTIFACT_SCHEMA_VERSION` /
  `--artifact-schema-version` (defaults to `catalog-source-artifact-v1`)
- `COMMERCE_NETWORK_GRPC_URL` / `--grpc-url` for apply
- `COMMERCE_NETWORK_ADMIN_TOKEN` for apply; environment only
- `COMMERCE_NETWORK_GRPC_TIMEOUT_SECONDS` / `--timeout-seconds`
- `COMMERCE_NETWORK_GRPC_CA_CERTIFICATE` / `--cacert`
- `COMMERCE_NETWORK_PROTO_ROOT` / `--commerce-proto-root`
- `DKH_PLATFORM_GRPC_PROTO_ROOT` / `--platform-proto-root`
- `GRPCURL_BIN` / `--grpcurl`

No secret or real participant/channel identifier belongs in the repository.
The default proto roots resolve to the canonical CommerceNetwork and
DKH.Platform checkouts in the GZDKH monorepo.

Reconcile a verified projection against the complete ProductCatalog product
baseline and the current catalog/definition reference:

```bash
node scripts/catalog-sources/reconcile-projection.js \
  --projection-dir=artifacts/catalog-source-projections/zzctea/zzctea-2026-07-27 \
  --catalog-ref=sources/prod/catalog-reference/prod-2026-07-27.json \
  --product-ref=sources/prod/product-reference/prod-products-2026-07-27 \
  --only=17641
```

The optional `--only` accepts exactly one canonical positive ZZCTea external
ID. Reconciliation uses only the immutable mapping
`externalId -> ZZC-<externalId>`; it never fuzzy-matches names. Existing
products are emitted as complete baseline-preserving patches and rollback
records. Only `en-US`/`zh-CN` description and meta-description fields may
change. Retail/catalog/tier/store prices and every unrelated nested collection
remain untouched. Missing products are reported as Draft-only proposals without
inventing a ProductCatalog payload.

Outputs live under a reference-bound ignored path below
`artifacts/catalog-source-reconciliations/`. The content-addressed bundle
contains mappings, full product patches, rollback products, a report, and a
manifest written last. It records the projection, catalog reference, product
manifest/tree/data/code-set hashes and workspace ID. The product export has a
strict complete manifest; the current catalog reference has no completeness
manifest, so the output explicitly sets
`catalogReferenceCompletenessProven: false`,
`productCatalogReconciliationComplete: false`, and `productionWrites: false`.

The connector is fixed to the robots-allowed public HTML routes
`https://zzctea.com/teaList?page={page}` and
`https://zzctea.com/teaDetail/{externalId}.html`. It never calls `/api/` or
`/official/api/`. The transport enforces exact host/path boundaries, response
size limits, timeouts and retry/backoff.

All outbound attempts, including retries, share one start-time gate. The
default and minimum supported interval is 1,000 milliseconds; a reviewed slower
rate can be selected with `--minimum-request-interval-ms`. The interval is part
of the checkpoint-bound request parameters, so resume cannot silently switch to
a different crawl rate.

Before any list/detail request, each connector instance fetches
`/robots.txt` once with a 64 KiB `text/plain` limit. The validated
policy is evaluated for product token `DKH.TeaCatalogData` using
case-insensitive longest-agent matching; equally specific groups are combined
and `*` is only the fallback. It must explicitly allow the exact request target,
including the `/teaList?page=N` query;
malformed, redirected, oversized, non-200, non-text or disallowing policy fails
closed. A rejected policy remains cached in that instance. Its URL, cache scope
product token, full HTTP User-Agent and validation version are checkpoint-bound
request parameters.

For each product, the stable lookup URL remains
`/teaDetail/{externalId}.html`. The detail loader follows at most four manual
301/302/307/308 hops and accepts content only after a final 200 response. Every
hop is rechecked against robots policy, the host allowlist, and the exact
`/tea/{slug}.html` path; query strings and fragments are rejected. Automatic
redirect following is never enabled. The final destination is preserved exactly
as observed, including an allowlisted `www` hostname. A standalone canonical
lookup uses the same validation with bounded `HEAD` requests; the normal detail
flow reuses its already observed final URL and sends no duplicate request.

The HTML and complete `window.__NUXT__` state exist only transiently in memory.
A bounded parser supports the site's serialized data form without `eval` or a
JavaScript VM. It selects only `data[0].initialHotTea` or
`data[0].teaDetail`, applies a strict product-field allowlist and PII gate, and
serializes a minimal deterministic envelope. Seller/buyer/contact/profile
siblings are never copied to disk. Parsing uses a linear cursor and is bounded
to 4 MiB HTML, depth 64, 100,000 nodes, 256 KiB strings, 10,000 array elements,
2,000 object properties and 4,096 IIFE parameters/arguments.

## Output contract

An in-progress run writes ignored files to:

```text
sources/catalog-sources/<source>/snapshots/<snapshot>/
├── checkpoint.json
└── raw/
    ├── list/
    │   └── terminal-probe.envelope.json
    └── details/
```

Only the product-only sanitized list/detail envelope is retained after it
passes the connector's PII policy. Full source HTML and the complete Nuxt state
are never retained. The checkpoint binds source,
connector/parser/artifact versions and static request parameters. It is
portable evidence, but a local file or CI cache is not a durable authoritative
store. Preserve the successful artifact/checkpoint as a CI artifact or external
object before relying on cross-run resume; if it is unavailable or incompatible,
the runner fails closed.

Only a complete run publishes:

```text
artifacts/catalog-sources/<source>/<snapshot>/
├── catalog-source-artifact-v1.<sha256>.json
├── source-checkpoint.json
└── artifact-manifest.json
```

The manifest is written atomically after the artifact and portable checkpoint.
A partial run cannot publish a manifest, update `last-good.json`, or declare
deletions. The artifact always sets `authoritativeForDeletion: false`.

The artifact and manifest expose the exact connector version, while each item
has an immutable external ID, factual localized fields, images, stable and
observed canonical links, exact package components, raw package text,
diagnostics and per-payload digests. Source prices are reference observations,
never retail prices. Money and quantities are decimal strings. A derived package
price carries its original amount/basis, exact cumulative divisor, reduced exact
fraction and `half-up` scale-8 display rounding policy. The original observation
has `roundingPolicy.mode: none`; derivation stops before measurement units.

The manifest exposes both a byte-level artifact hash and a semantic digest.
The semantic digest uses deterministic item/key ordering and excludes
observation time. Offline replay verifies and reproduces a stored snapshot but
never promotes that snapshot over the current `last-good.json`.

For `totalPages` sources, completion always performs and hashes one terminal
`page = totalPages + 1` probe. Only an empty sanitized page or an exact
product-for-product repeat of the last page proves the end; new/different
products or paging drift reject the run.

The currently observed public `teaDetail` shape does not expose product
description prose, so this connector does not invent or scrape a description
from unrelated page content. If a reviewed product-only description field is
added later, its shape and safety policy require a connector/parser version
bump and fixture update.

Customer-facing projection text is generated from structured facts such as
brand, year, batch, process, shape, and exact package components. It does not
copy source prose and does not include `zzctea.com`. Both `zh-CN` and `en-US`
factual descriptions are emitted, using the source title as a non-translated
fallback when no reviewed English title exists.

## Gates

The runtime fails closed on:

- endpoint, TLS, host, port, response-size or UTF-8 violations;
- Nuxt assignment/shape drift, sanitized-envelope, required field or count drift;
- repeated pages, duplicate IDs, early short pages or incomplete details;
- incompatible checkpoint versions/request parameters;
- PII-like fields, mobile/landline numbers, emails or contact handles in any
  persisted string;
- a total-count drop or growth outside the reviewed thresholds.

No source connector, projector, or reconciler in this directory writes
ProductCatalog, CommerceNetwork, or any production database. The separate
Commerce publisher is dry-run by default and can write only the explicitly
selected one-item observation canary after `--apply --yes`. ProductCatalog
reconciliation, authoritative reference acquisition, source registration,
authorized Commerce read-back, canary approval, and any later mass apply remain
separate reviewed steps.

Run the offline suite:

```bash
node scripts/catalog-sources/test-zzctea-contract.js
node scripts/catalog-sources/test-zzctea-connector.js
node scripts/catalog-sources/test-http.js
node scripts/catalog-sources/test-runtime.js
node scripts/catalog-sources/test-projection.js
node scripts/catalog-sources/test-projection-cli.js
node scripts/catalog-sources/test-reconciliation-references.js
node scripts/catalog-sources/test-reconciliation.js
node scripts/catalog-sources/test-reconciliation-cli.js
node scripts/catalog-sources/test-commerce-publication.js
```
