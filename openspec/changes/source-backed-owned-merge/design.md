# Design

`buildSourceBackedProposal` accepts an optional `lastAppliedProduct`. The
source-owned collections are merged by stable keys: translation locale,
specification attribute, tag code and origin position. For each key, the
three-way rule is:

- current equals last applied: apply the new source value;
- incoming equals last applied or current equals incoming: keep the current
  value;
- both source and destination changed: preserve the current value and emit a
  `three-way-conflict` review record.

The existing fill-missing proposal remains the fallback when no last-applied
source is available. The proposal identity records `(source system, external
ID, entity kind)` and preserves the complete baseline product for rollback and
reconciliation. Source-owned updates never touch price, stock, publication,
packages, variants or unrelated collections.
