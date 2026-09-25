# Source-backed ownership-aware merge

The source-backed proposal path must update values owned by TheTea only when
the current destination still equals the last applied source. A manually
changed destination value must become a review conflict. Stable provider and
external IDs remain attached to every proposal while commercial, publication,
package, variant and unrelated fields stay in the destination baseline.
