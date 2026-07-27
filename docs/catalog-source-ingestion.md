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
Customer-facing descriptions are a later DKH-authored projection and must not
embed `zzctea.com` boilerplate.

The runtime fetches neither seller/buyer lists nor contact/profile data. Raw
encrypted list/detail responses are stored only after the decrypted payload
passes PII policy. A partial or drifted run preserves the last good artifact and
cannot create tombstones or production mutations.

See [`../scripts/catalog-sources/README.md`](../scripts/catalog-sources/README.md)
for commands, output layout and operator gates.
