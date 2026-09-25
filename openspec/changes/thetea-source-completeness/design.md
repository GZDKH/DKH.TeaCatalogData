# Design

`fetch-snapshot.js` uses English only for the language-neutral `/teas` and
`/infusions` discovery lists. It then requests every resolved `--langs` and
`--field-langs` value independently. Existing tea cards retain their
`raw/cards/<lang>/<slug>.json` path so generated import artifacts remain
compatible. Category and infusion cards use `raw/entities/<kind>/cards/...`
and never enter `manifest.slugs`.

The manifest is the audit boundary:

- `entityInventory` records source endpoint, kind claim and classification
  evidence;
- `entityObservations` compares the card's kind with the inventory row;
- `entityCardFiles` and `missingEntityCardFiles` prove full-card attempts;
- `fieldCoverage` records expected, fetched and missing field details;
- `cardLanguageMismatches` and `errors` retain 402/404/429 and language
  fallback evidence; a mismatched response is never used for detail extraction;
- `sourceContract` stores the expected contract files and SHA-256 hashes.

The existing generation path consumes only tea slugs. Operators must resolve
an entity mismatch or a missing paid-locale card before generating a complete
multilingual import. A partial diagnostic snapshot remains useful, but its
manifest errors are not silently downgraded to a successful import.
