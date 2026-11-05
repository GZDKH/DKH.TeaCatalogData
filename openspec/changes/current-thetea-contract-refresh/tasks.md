## Execution references

Durable execution steps and status are tracked in personal Beads `denis-u6e` and GitLab issue `gzdkh/data/DKH.TeaCatalogData#62`. This document does not duplicate the task tracker.

## Acceptance sequence

First qualify current-schema fixtures and API-only source provenance. Then run the maintained offline CI suite and strict OpenSpec validation against the exact authored revision. Publish the owned branch for independent current-head review and CI. Production acceptance requires a validated artifact, one-product and topic canary with readback, separate mass-apply approval, full reconciliation, and authoritative main evidence. Runtime work must retain its actual source/reference hashes and cannot be marked complete from the source pipeline alone.
