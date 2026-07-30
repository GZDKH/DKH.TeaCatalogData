# Public catalog source ingestion

This directory contains one source-agnostic snapshot runtime and small,
reviewed connectors. Adding a source means implementing the fixed connector
interface plus sanitized fixtures. It does not mean creating another service,
adding source-specific code to CommerceNetwork, or accepting JavaScript from an
administrator.

## ZZCTea

Run the complete weekly refresh from verified ProductCatalog references to the
atomic operator bundle:

```bash
node scripts/catalog-sources/update-zzctea-current.js \
  --snapshot=zzctea-2026-07-28-weekly-v1 \
  --catalog-ref=sources/prod/catalog-reference/prod-2026-07-27.json \
  --product-ref=sources/prod/product-reference/prod-products-2026-07-28-post-import \
  --previous-media-dir=/absolute/path/to/artifacts/catalog-source-import-bundles/zzctea/current/media \
  --minimum-request-interval-ms=1000
```

The source seed is a deterministic union of every exact `ZZC-<externalId>` in
the complete, hash-verified ProductCatalog export and public discovery across
the 13 reviewed `brandIds`. Details are refreshed by immutable external ID, so
the existing 3,151 products stay covered even if a public list changes; newly
discovered IDs become unpublished, price-free ProductCatalog Drafts. The run is
resumable at both detail and media stages. Every upstream result is immutable,
and `import/zzctea/current` is swapped only after all bindings and hashes pass.
No production write is performed.

Source-generated product text is deliberately limited to one `zh-CN`
translation. Its name is the exact source title; year, processing, shape,
brand, package facts and safe aggregate market signals remain separate facts.
SEO, meta title and meta description fields are omitted so
`DKH.Platform.Seo` can generate them during a compatible ProductCatalog import.
The canonical source bundle remains `zh-CN`-only and `applyAllowed: false`; the
collector does not invent an English mirror. Reviewed human translations are
added only through the separate source-bound round trip below.

Create one human translation handoff package without changing the verified
Chinese source artifact:

```bash
node scripts/catalog-sources/export-chinese-product-markdown.js \
  --artifact=/absolute/path/to/import/zzctea/current \
  --context-bundle=/absolute/path/to/artifacts/catalog-source-import-bundles/zzctea/current \
  --source-archive=/absolute/path/to/artifacts/zzctea-translations/source-artifact \
  --out=/absolute/path/to/artifacts/zzctea-translations/zh-CN-source
```

Each Markdown file contains the Chinese name and description plus every
available business fact needed for translation context: brand, year, batch,
processing, shape, package hierarchy, release data, complete reference-price
observations, market aggregates and trends, source links, and source/local
image mappings. It has no English instructions, locale fields, front matter,
placeholders, or SEO fields. The protected `translation-manifest.json` binds
filenames to the exact verified import bundle, source product codes, context
hashes, and Markdown hashes. The source archive retains the exact full Admin
Console artifact and local photos while translations are in progress, even
when a weekly refresh later replaces `current`.

After the complete translated directory returns, supply its target BCP 47
locale and materialize a separate verified Admin Console artifact:

```bash
node scripts/catalog-sources/import-translated-product-markdown.js \
  --artifact=/absolute/path/to/artifacts/zzctea-translations/source-artifact \
  --translations=/absolute/path/to/artifacts/zzctea-translations/returned \
  --locale=en-US \
  --out=/absolute/path/to/import/zzctea/translated/en-US
```

The round trip is local and atomic. It preserves `applyAllowed: false`,
`canaryRequired: true`, and `productionWrites: false`; a one-product translated
canary and read-back are still mandatory before a full import.

Each source-product mapping carries both the stable lookup URL and the observed
canonical product URL. Reference prices, ranges, trends and aggregate demand /
supply counts are source observations, never ProductCatalog retail prices.

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
records. Only managed factual descriptions and source-owned specifications may
change. Retail/catalog/tier/store prices and every unrelated nested collection
remain untouched. Missing products receive a complete unpublished Draft payload
with stable code/SKU and conservative `CATALOG-PUERH` memberships, but no retail
price.

Outputs live under a reference-bound ignored path below
`artifacts/catalog-source-reconciliations/`. The content-addressed bundle
contains mappings, full product patches, rollback products, a report, and a
manifest written last. It records the projection, catalog reference, product
manifest/tree/data/code-set hashes and workspace ID. The product export has a
strict complete manifest; the current catalog reference has no completeness
manifest, so the output explicitly sets
`catalogReferenceCompletenessProven: false`,
`productCatalogReconciliationComplete: false`, and `productionWrites: false`.

Materialize the original source images only after the source/image-use review
has been approved. This stage downloads files into an ignored local artifact;
it does not upload to MediaService or change a product:

```bash
node scripts/catalog-sources/materialize-media.js \
  --artifact-dir=artifacts/catalog-sources/zzctea/zzctea-2026-07-28-full-catalog-v2 \
  --reconciliation-dir=artifacts/catalog-source-reconciliations/zzctea/zzctea-2026-07-28-full-catalog-v2/<reference-binding>/full \
  --minimum-request-interval-ms=1000
```

Use `--only=<external-id>` for a one-product live canary. The downloader:

- verifies the complete source artifact and exact `ZZC-<external-id>` product
  reconciliation before making a request;
- revalidates HTTPS, host, path, query and every manual redirect against the
  reviewed ZZCTea image policy;
- chooses the original unqueried image and records the omitted `square480`
  derivative as an alias instead of downloading both;
- accepts only JPEG, PNG and WebP after matching `Content-Type` to magic bytes;
- defaults to a 20 MiB per-image streaming limit, a 10 GiB aggregate limit and
  one request start per second;
- writes content-addressed blobs, an atomic resume checkpoint, URL-to-SHA-256
  receipt and a deterministic SetupTool media-item manifest;
- marks every output `productionWrites: false`.

The default ignored output is
`artifacts/catalog-source-media/<source>/<snapshot>/<artifact-sha>/<mapping-sha>/<selection>/`.
An interrupted run resumes from `media-checkpoint.json`; a changed input,
limit, rate, or hash-mismatched local blob fails closed. The final
`media-manifest.json` is written last.

For a later reviewed upload, configure a SetupTool media section with
`scope: "products"`, `ownerKey: "productCode"`, `source: "manifest"`,
`path: "media-items.json"` and
`galleryStrategy: "reconcile-source-managed"`, with its `basePath`
pointing at the materialized output. The generated manifest keeps
`setupTool.enabled: false`; enabling apply is a separate reviewed operation.
The media items carry their expected `sha256` and `bytes`, but the current
SetupTool reader does not enforce those fields or path containment. Keep upload
disabled until SetupTool verifies the final media manifest, every item hash and
size, and rejects absolute, escaping or symlinked files. After that gate,
SetupTool uses the authenticated AdminGateway upload-session flow to
MediaService/S3. Do not point this downloader at S3 directly. A recurring sync
must replace only this source's managed attachment set and preserve unrelated
or manually managed media.

Optional limits:

- `--max-file-bytes=<bytes>`
- `--max-total-bytes=<bytes>`
- `--timeout-ms=<milliseconds>`
- `--minimum-request-interval-ms=<1000..60000>`

The weekly command also requires an absolute, normalized
`--previous-media-dir`. It must point to the verified prior internal cache at
`artifacts/catalog-source-import-bundles/zzctea/current/media`. Unchanged blobs
are reused with copy-on-write cloning; new or changed source URLs are
downloaded and verified before either atomic output is swapped. The internal
cache is deliberately outside `import/zzctea/`, so selecting the import folder
cannot expose evidence JSON to Data Import Console.

After the source, projection, reconciliation, and media outputs are complete,
assemble one operator-facing version:

```bash
node scripts/catalog-sources/build-import-bundle.js \
  --artifact-dir=artifacts/catalog-sources/zzctea/<snapshot> \
  --catalog-ref=sources/prod/catalog-reference/<snapshot>.json \
  --projection-dir=artifacts/catalog-source-projections/zzctea/<snapshot> \
  --reconciliation-dir=artifacts/catalog-source-reconciliations/zzctea/<snapshot>/<reference-binding>/full \
  --media-dir=artifacts/catalog-source-media/zzctea/<snapshot>/<artifact-sha>/<mapping-sha>/full
```

The default operator output is ignored `import/zzctea/current/`. It contains
only Data Import Console-supported files:

```text
import/zzctea/current/
├── 01-reference/catalogs.json
├── 02-specifications/
├── 03-categories/categories.json
├── 04-products/<category>/ZZC-<id>.json
├── 05-catalog-bindings/catalogs.json
├── 06-routed-content/
├── 07-media/products/
│   ├── media.json
│   └── ZZC-<id>/<ordered-local-image>
└── artifact-manifest.json
```

Each product file contains exactly one record and stays below the Console's
3 MiB batching ceiling, so canary imports really select one product. The media
manifest preserves source order and cover selection; every referenced image is
local to its product directory. Evidence, rollback arrays and checkpoints are
never copied into the selected import tree.

Inputs are revalidated before packaging. Files are copied with filesystem
copy-on-write cloning when available, never symlinked. The builder first
atomically refreshes the verified internal cache under
`artifacts/catalog-source-import-bundles/zzctea/current/`, then atomically
replaces the Console artifact. The final `artifact-manifest.json` binds every
file and records `applyAllowed: false`, `productionWrites: false`, and
`canaryRequired: true`. Do not edit those flags manually. Validate the whole
folder and import one product before importing all products and media.

The reusable cache is not a release pointer and may safely advance if final
Console publication fails. Each cached file remains bound to its verified
source receipt; the next run reuses only matching source URLs and hashes. The
operator-visible `import/zzctea/current/` is replaced only after its own full
staging verification succeeds.

The connector is fixed to the robots-allowed public HTML routes
`https://zzctea.com/teaList?page={page}&brandIds={reviewed-brand}` and
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
The same versioned, checkpoint-bound canonical-reference policy is embedded in
the artifact and revalidated by the source-neutral runtime. Phone-shaped digits
are permitted only as opaque content of a fully validated canonical slug;
labelled contacts, query/fragment delimiters, alternate schemes and alternate
hosts are rejected.

The HTML and complete `window.__NUXT__` state exist only transiently in memory.
A bounded parser supports the site's serialized data form without `eval` or a
JavaScript VM. It selects only `data[0].initialHotTea` or
`data[0].teaDetail`, applies a strict product-field allowlist and PII gate, and
serializes a minimal deterministic envelope. Seller/buyer/contact/profile
siblings and known nonpersisted price-chart UI payloads are never copied to
disk. Parsing uses a linear cursor and is bounded
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

Only references accepted by the versioned public-image policy are retained:
HTTPS `oss.yf-gz.cn` `/file/...` paths or one opaque root-level image filename,
with no credentials, port, or fragment and at most the exact
`x-oss-process=style/...` transform. Opaque asset identifiers may contain long
digit sequences; they bypass the phone-number heuristic only after the entire
URL satisfies this narrow policy. Invalid non-PII image references remain
diagnostic input and are excluded from the normalized artifact. The later
media stage downloads accepted originals into local content-addressed blobs.

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
