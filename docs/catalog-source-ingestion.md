# Public Catalog Source Ingestion

The public catalog ingestion module is an ETL boundary, not a commerce provider
runtime. It belongs to `DKH.TeaCatalogData` and produces a versioned,
source-agnostic artifact for later reviewed ProductCatalog projection.

The shared runtime owns paging, bounded concurrency, retries, response limits,
checkpoints, raw/normalized digests, replay and drift gates. A connector owns
only its fixed public routes, safe extraction and normalization rules.
Administrators can eventually configure deployed connector instances and
schedules, but cannot upload or execute parser JavaScript.

ZZCTea is a market/reference-price source. Its values never overwrite DKH retail
or catalog prices. The normalized artifact distinguishes original observations
from derived package-unit observations and records exact derivation provenance.
The currently observed public detail shape exposes no product-description
field. The offline projection creates `zh-CN` and `en-US` DKH factual
descriptions from structured facts and exact package components; it neither
copies source prose nor embeds `zzctea.com` boilerplate.

The connector calls only the robots-allowed public HTML list/detail routes.
Each connector instance first validates one bounded `text/plain` robots policy.
The exact path plus query must be explicitly allowed for the connector's fixed
product token using longest case-insensitive agent matching; `User-agent: *` is
only the fallback. A failed policy remains a cached failure for that run.
`/teaList` represents the public HTML hot-tea catalog; it is not evidence of
the complete, larger inventory behind the robots-disallowed `/api/` routes.
The runtime keeps those source scopes separate and never reports the HTML
snapshot as the complete ZZCTea inventory.
Robots allowance does not grant a content-reuse license. Multi-item live
snapshotting and source-image reuse remain blocked until source permission or
terms, image policy, and the request-rate limit are reviewed.
The reviewed ZZCTea transport applies one monotonic start-time gate to all
outbound attempts, including retries. Its default and minimum interval is one
second, and that value is bound into the resumable checkpoint so a resumed run
cannot silently increase the crawl rate.
Full HTML and the complete embedded Nuxt state remain in memory and are never
persisted. Only strict product-field allowlisted, PII-free list/detail envelopes
are stored; seller/buyer/contact/profile sibling branches are discarded before
serialization. A standalone canonical check uses bounded strict `HEAD` requests.
During ingestion the final canonical `/tea/{slug}.html` destination and detail
body are obtained through a maximum of four manually validated GET redirect hops,
with robots and host/path policy rechecked at every hop; automatic redirect
following is disabled. A sanitized `totalPages + 1` probe must be empty or exactly repeat
the last page before completion. A partial or drifted
run preserves the last good artifact and cannot create tombstones or production
mutations.

The verified offline projection emits provider-neutral CommerceNetwork
observation DTOs plus a deterministic report and hash manifest. It performs no
network or production writes. ProductCatalog reconciliation and CommerceNetwork
publication require complete authoritative references, read-back, a
one-product canary, and the later reviewed apply phase.

The offline ProductCatalog reconciliation uses exact immutable
`ZZC-<externalId>` product codes and a complete nested product export. It emits
full baseline-preserving product patches, rollback aggregates, deterministic
source mappings, and Draft-only reports for missing products. It does not
perform fuzzy matching or mutate any retail/catalog price. The current catalog
reference snapshot is structurally verified and hashed but lacks its own
completeness manifest, so reconciliation remains explicitly non-authoritative
and publication-ineligible.

See [`../scripts/catalog-sources/README.md`](../scripts/catalog-sources/README.md)
for commands, output layout and operator gates.
