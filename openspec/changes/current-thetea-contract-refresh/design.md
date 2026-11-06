## Context and decision

Extend the existing ETL and native SetupTool import rather than introduce another writer. The user selected tea products, category knowledge articles, all advertised 72 locales, and API-only acquisition. These accepted scope decisions remain unchanged. Implementation details below are executor decisions, not additional user approvals.

## Approaches

Individual field requests remain compatible but multiply the all-locale crawl into millions of requests. Cloudflare D1 packs are an existing alternative explicitly declined by the user. The selected optional API card-sections mode uses the documented complete TeaCard sections, with endpoint-equivalence evidence from 13,215 captured field values and zero differences. It retains the canonical API response rather than fabricating endpoint responses. Markdown and similar routes remain captured as before.

The places route has no documented offset. A bounded union of documented kind/q searches is accepted only when natural keys (kind, hanzi, pinyin) match all metadata counts. The API includes distinct pinyin spellings for the same hanzi, so hanzi alone is not an identity. Glossary uses documented offset pages. Every page is retained and hashed; incomplete query coverage fails closed.

## Destination preservation

A current baseline is identified by packageBindings. Current projection emits the seven current nested collections; it preserves operator-owned existing bindings and unrelated fields without mapping legacy quantities or defaults. Source slug identity resolution is restricted to TEA records, preserves prior codes on country changes, and fails ambiguities. Legacy baselines remain replayable and mixed baselines are rejected.

## Knowledge and writes

Category topics stay in a separate hash-bound bundle. The preparation command reuses native article/FAQ DTOs and writes local records plus receipts. Actual mutation continues through SetupTool/AdminGateway. New content defaults to draft. The existing one-product canary, readback and separate mass-apply approval remain required.

## Verification and remaining operational acceptance

Maintained offline fixtures cover both schemas, preservation, identity conflicts, topic routing and origin-bound credentials. API acquisition must prove every reference count, raw card hash and locale. Source-only CI does not establish a production synchronization: actual generated-artifact validation, canary/readback, mass approval and final reconciliation remain execution acceptance in GitLab issue 62 and personal Beads denis-u6e.
