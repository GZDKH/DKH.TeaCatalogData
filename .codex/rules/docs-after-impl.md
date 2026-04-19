<!-- GENERATED FILE — DO NOT EDIT LOCALLY -->
<!-- Source: rules/universal/docs-after-impl.md (in DKH.AgentRules) -->
<!-- To change this rule, edit the source and run: pwsh scripts/sync-claude-rules.ps1 -All -->

---
description: Documentation update requirements after implementation changes
globs: "**/*"
alwaysApply: false
---

# Documentation After Implementation (BLOCKING — MANDATORY)

**CRITICAL**: After implementing ANY feature, fix, or refactor, you MUST update the affected documentation BEFORE creating the MR. Documentation debt is treated the same as code debt — it blocks merge.

## When to Update Documentation

| Change type | Local docs (`docs/`) | DKH.Architecture | Project README |
|-------------|---------------------|------------------|----------------|
| New domain entity / aggregate | `domain-model.md` | service profile | — |
| New gRPC service or RPC method | `grpc-api.md` | service profile | — |
| New REST endpoint (gateway) | `rest-api.md` or `openapi.md` | gateway profile | — |
| Database schema change / migration | `database.md` | — | — |
| New feature module (FSD) | `architecture.md` | — | Update page/feature inventory |
| New shared UI component | — | — | Update component inventory |
| New page / route | `architecture.md` | — | Update route inventory |
| Architecture decision | `architecture.md` or `adr/` | — | — |
| New integration with another service | `integrations.md` | service profile | — |
| State machine / lifecycle change | `<entity>-lifecycle.md` | — | — |
| New API client (Orval) | `api-client.md` | — | Update API clients section |
| i18n namespace change | `i18n.md` | — | — |
| New configuration key | CLAUDE.md | — | — |
| Import/export functionality | `data-exchange.md` | — | — |

## Documentation Structure Reference

### .NET services (`docs/`)

```
docs/
├── README.md           # Index with table of contents (ALWAYS update when adding new doc)
├── architecture.md     # Design decisions, patterns
├── domain-model.md     # Entities, aggregates, value objects
├── grpc-api.md         # gRPC service methods reference
├── database.md         # Schema, migrations, EF Core config
├── integrations.md     # External service integrations
├── ru/                 # Russian translations (mirror structure)
└── plans/              # Temporary (delete after completion)
```

### Gateways (`docs/`)

```
docs/
├── README.md           # Index
├── architecture.md     # Gateway patterns, BFF design
├── authorization.md    # Auth/RBAC rules
├── rest-api.md         # REST endpoint reference
├── openapi.md          # OpenAPI/Swagger documentation
├── dto-mapping.md      # DTO ↔ gRPC mapping conventions
├── grpc-clients.md     # gRPC client configuration
├── ru/                 # Russian translations
└── plans/
```

### Next.js UI (`docs/`)

```
docs/
├── README.md           # Index + comprehensive inventory (pages, features, widgets, entities, shared)
├── architecture.md     # FSD layers, design decisions
├── api-client.md       # Orval wrappers, API integration
├── i18n.md             # Internationalization strategy
├── ui-toolkit.md       # DaisyUI component inventory
├── adr/                # Architecture Decision Records
├── ru/                 # Russian translations
└── plans/
```

### DKH.Architecture (central documentation)

```
en/services/
├── backend/<service>-index.md     # Comprehensive service profile
├── frontend/<ui>-index.md         # UI project profile
├── gateways/<gateway>-index.md    # Gateway profile
└── <category>/README.md           # Category table (all services listed)
```

## Update Rules by Project Type

### .NET services — after adding new entity/feature

1. **`docs/domain-model.md`** — add entity description, fields, relationships, invariants
2. **`docs/grpc-api.md`** — add new RPC methods with request/response descriptions
3. **`docs/database.md`** — add new table schema, migration name
4. **`docs/README.md`** — add new doc file to the contents table if created
5. **`en/services/backend/<service>-index.md`** in DKH.Architecture — update capabilities/API section

### .NET services — after adding new migration

1. **`docs/database.md`** — document the migration: name, what it changes, any data impact

### Gateways — after adding new endpoint

1. **`docs/rest-api.md`** — add endpoint: method, path, request/response body, auth requirements
2. **`docs/dto-mapping.md`** — add DTO ↔ gRPC mapping if new types introduced
3. **`docs/grpc-clients.md`** — add new gRPC client if connecting to a new service
4. **`en/services/gateways/<gateway>-index.md`** in DKH.Architecture — update endpoint list

### Next.js UI — after adding new page/feature/component

1. **`docs/README.md`** — update the relevant inventory section:
   - New page → add to "Pages" table with route path
   - New feature → add to "Features" table with module path
   - New widget → add to "Widgets" table
   - New shared component → add to "Shared UI Components" table
   - New shared utility/hook → add to "Shared Libraries" table
   - New API client → add to "API Clients" table
2. **`docs/architecture.md`** — update if new FSD slice or architectural pattern introduced
3. **`docs/api-client.md`** — update if new Orval client wrapper added
4. **`docs/i18n.md`** — update if new i18n namespace or locale handling added

### Cross-cutting — after architecture decisions

1. **`docs/architecture.md`** or **`docs/adr/<number>-<title>.md`** — document the decision: context, decision, consequences

## Russian Translation Rules

- **English is canonical** — update `docs/` (English) first
- **Russian mirror** — update `docs/ru/` with the same content in Russian
- If Russian translation is not ready, add a stub:
  ```markdown
  > Translation Pending — see [English version](../domain-model.md)
  ```
- **DKH.Architecture**: update both `en/` and `ru/` service profiles

## Pre-MR Documentation Checklist

Before creating the Merge Request, verify:

- [ ] **Local docs updated** — all affected `docs/` files reflect the implementation
- [ ] **docs/README.md index** — new documents listed in the contents table
- [ ] **Russian translations** — `docs/ru/` updated or stub added
- [ ] **DKH.Architecture** — service/gateway/UI profile updated if public API changed
- [ ] **CLAUDE.md** — updated if new configuration keys, commands, or workflows added
- [ ] **No stale docs** — removed references to deleted features/endpoints

## Anti-patterns (FORBIDDEN)

| Anti-pattern | Fix |
|-------------|-----|
| Adding gRPC methods without updating `grpc-api.md` | Update docs in the same commit or immediately after |
| Adding database migration without documenting in `database.md` | Add migration description to database.md |
| Adding new page/feature without updating README inventory | Update the relevant inventory table |
| Adding REST endpoint without updating `rest-api.md` | Document endpoint with method, path, auth, body |
| Leaving `docs/ru/` completely out of date | At minimum add a "Translation Pending" stub |
| Updating DKH.Architecture but not local `docs/` | Both must be updated — local is the source of truth for implementation details |
| Adding new doc file without listing in `docs/README.md` | Every doc must be in the README index table |

## When Documentation is NOT Required

- Typo fixes, formatting-only changes
- Internal refactoring that doesn't change public API or behavior
- Dependency version bumps (unless they change behavior)
- CI/CD pipeline changes (unless they affect developer workflow)
- Test-only changes (unless they demonstrate new patterns)
