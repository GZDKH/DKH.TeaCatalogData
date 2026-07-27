# Public Catalog Source Ingestion

The public catalog ingestion module is an ETL boundary, not a commerce provider
runtime. It belongs to `DKH.TeaCatalogData` and produces a versioned,
source-agnostic artifact for later reviewed ProductCatalog projection.

The shared runtime owns paging, bounded concurrency, retries, response limits,
checkpoints, raw/normalized digests, replay and drift gates. A connector owns
only its fixed public endpoints, response decoder and normalization rules.
Administrators can eventually configure deployed connector instances and
schedules, but cannot upload or execute parser JavaScript.

ZZCTea is a market/reference-price source. Its values never overwrite DKH retail
or catalog prices. The normalized artifact distinguishes original observations
from derived package-unit observations and records exact derivation provenance.
The artifact retains only reviewed safe plain-text detail descriptions as source
evidence. The offline projection creates `zh-CN` and `en-US` DKH factual
descriptions from structured facts and exact package components; it neither
copies source prose nor embeds `zzctea.com` boilerplate.

The runtime fetches neither seller/buyer lists nor contact/profile data. Raw
encrypted list/detail responses are stored only after the decrypted payload
passes PII policy. A partial or drifted run preserves the last good artifact and
cannot create tombstones or production mutations.

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
