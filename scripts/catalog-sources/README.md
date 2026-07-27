# Public catalog source ingestion

This directory contains one source-agnostic snapshot runtime and small,
reviewed connectors. Adding a source means implementing the fixed connector
interface plus sanitized fixtures. It does not mean creating another service,
adding source-specific code to CommerceNetwork, or accepting JavaScript from an
administrator.

## ZZCTea

Run a full public-catalog snapshot:

```bash
node scripts/catalog-sources/fetch-snapshot.js \
  --source=zzctea \
  --snapshot=zzctea-2026-07-27 \
  --resume \
  --concurrency=4
```

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

The connector is fixed to the public HTTPS list and single-tea endpoints used by
the website. It sends `HEAD` only to
`https://zzctea.com/teaDetail/{externalId}.html` and accepts a validated
`/tea/{slug}.html` redirect. It never requests public buy/sell lists, contacts,
profiles or phone fields. Redirects are not followed automatically.

The browser's AES-CBC key, IV and request-signature suffix are public protocol
material, not credentials. The transport enforces exact host/path boundaries,
streaming response-size limits, timeouts and retry/backoff. Decryption uses
strict fatal UTF-8 and lossless JSON number parsing.

## Output contract

An in-progress run writes ignored files to:

```text
sources/catalog-sources/<source>/snapshots/<snapshot>/
├── checkpoint.json
└── raw/
    ├── list/
    └── details/
```

The raw encrypted response is retained only after its decrypted list/detail
payload passes the connector's PII policy. The checkpoint binds source,
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

When a reviewed plain-text description is present in the public detail payload,
the normalized artifact retains it as source evidence. List-page prose is never
trusted as a description. HTML, control characters, URLs, domains, source-site
branding, transaction boilerplate, and overlong text are omitted with a
diagnostic; PII remains a hard rejection.

Customer-facing projection text is generated from structured facts such as
brand, year, batch, process, shape, and exact package components. It does not
copy source prose and does not include `zzctea.com`. Both `zh-CN` and `en-US`
factual descriptions are emitted, using the source title as a non-translated
fallback when no reviewed English title exists.

## Gates

The runtime fails closed on:

- endpoint, redirect, TLS, host, port, response-size or UTF-8 violations;
- encrypted envelope, JSON root, required field or count drift;
- repeated pages, duplicate IDs, early short pages or incomplete details;
- incompatible checkpoint versions/request parameters;
- PII-like fields or phone patterns in accepted raw payloads or artifacts;
- a total-count drop or growth outside the reviewed thresholds.

No code in this directory writes ProductCatalog, CommerceNetwork, or any
production database. The offline projection matches the approved
CommerceNetwork observation contract but deliberately has no network client.
ProductCatalog reconciliation, authoritative reference acquisition, source
registration, one-product canary, and mass apply remain separate reviewed
steps.

Run the offline suite:

```bash
node scripts/catalog-sources/test-zzctea-contract.js
node scripts/catalog-sources/test-zzctea-connector.js
node scripts/catalog-sources/test-http.js
node scripts/catalog-sources/test-runtime.js
node scripts/catalog-sources/test-projection.js
node scripts/catalog-sources/test-projection-cli.js
```
