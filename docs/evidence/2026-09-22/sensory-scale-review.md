# Sensory scale review

Status: `owner-approval-required`; normalized publication is disabled.

The current TheTea snapshot contains fifteen stable source descriptor IDs (`Be`, `Ch`, `Cz`, `Dt`, `H`, `L`, `Li`, `Lm`, `Mn`, `Mw`, `O`, `Pc`, `Rb`, `Sb`, `Se`) and observed values from 1 through 5. The payload does not declare a scale name, anchors, a valid zero value, or a conversion rule. An absent descriptor is absence from the source array, not an intensity of zero.

The Sensory Codes 2019 document is retained as candidate label evidence for the IDs. It is a cross-domain vocabulary and does not establish TheTea's numeric semantics. The tea.degree ten-axis rubric documents a separate 1–10 session assessment; it is not evidence that the TheTea descriptor values should be multiplied, offset, or otherwise mapped to 1–10.

Until the TheTea owner or catalog owner approves a versioned scale and anchors, consumers must preserve the native numeric value as source evidence, keep the opaque descriptor ID, and suppress normalized public charts. The machine-readable decision and approval checklist are in [`sensory-scale-review.json`](./sensory-scale-review.json).
