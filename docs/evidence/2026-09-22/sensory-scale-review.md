# Sensory scale review

Status: `approved-source-native-scale`; source-native publication is enabled and normalization remains disabled.

The current TheTea snapshot contains fifteen stable source descriptor IDs (`Be`, `Ch`, `Cz`, `Dt`, `H`, `L`, `Li`, `Lm`, `Mn`, `Mw`, `O`, `Pc`, `Rb`, `Sb`, `Se`) and observed values from 1 through 5. The catalog owner approved the versioned source-native ordinal scale `thetea-native-intensity` (1–5). An absent descriptor is absence from the source array and remains `unknown`; zero is invalid.

The Sensory Codes 2019 document is retained as candidate label evidence for the IDs. It is a cross-domain vocabulary and does not establish TheTea's numeric semantics. The tea.degree ten-axis rubric documents a separate 1–10 session assessment; it is not evidence that the TheTea descriptor values should be multiplied, offset, or otherwise mapped to 1–10.

Consumers must preserve the native numeric value as source evidence, keep the opaque descriptor ID, and render only the source-native 1–5 axis. No qualitative anchors are inferred and no value is converted to 1–10. The machine-readable decision and approval record are in [`sensory-scale-review.json`](./sensory-scale-review.json).
