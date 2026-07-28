<!-- GENERATED FILE — DO NOT EDIT LOCALLY -->
<!-- Source: rules/on-demand/contracts.md (in DKH.AgentRules) -->
<!-- To change this rule, edit the source and run: pwsh scripts/sync-claude-rules.ps1 -All -->

---
description: gRPC Contracts / Proto rules — version bump is BLOCKING
globs: "**/*"
alwaysApply: true
---

# Contracts & Proto rules (MANDATORY)

## Proto naming

- Entity messages: `<Entity>Model` (NEVER `*Data`)
- Requests: `Create<Entity>Request`, `Update<Entity>Request`, `Delete<Entity>Request`, `Get<Entity>Request`, `List<Entity>sRequest`
- List response: `List<Entity>sResponse` (with `repeated`, `total_count`, `page`, `page_size`)

## RPC return types

- **Create / Update / Get** → return `<Entity>Model` directly (no wrapper)
- **Delete** → return `google.protobuf.Empty`
- **List** → return `List<Entity>sResponse`
- **Errors** → use gRPC `StatusCode` (`NotFound`, `InvalidArgument`, `AlreadyExists`), NEVER response fields

## Field numbers

- Field numbers are **permanent** — NEVER reuse
- Removed fields → `reserved <number>; reserved "<name>";`
- New fields → always use new, unused numbers

## Breaking changes

- Breaking changes go to new version folder (`v2/`, `v3/`)
- NEVER modify existing version in-place for breaking changes
- Warn the user and list affected consumers from the dependency graph

## version.json — BLOCKING VERSION BUMP (CRITICAL)

**CRITICAL**: Every proto change MUST include a `version.json` bump in the SAME branch/MR. Forgetting to bump the version means the package won't publish, requiring a separate throwaway branch just to fix the version. This is the #1 most common mistake.

### Location

`<ServiceName>.Contracts/version.json`

### Version classification (SemVer)

| Change type | Version bump | Examples |
|-------------|-------------|----------|
| **Docs only** | patch (0.0.X) | Comment updates, no API surface change |
| **Additive** | minor (0.X.0) | New fields with new numbers, new RPC methods, new services, new enum values |
| **Breaking** | major (X.0.0) | Removed/renamed fields, changed field types/numbers, removed RPCs |

### MANDATORY workflow after ANY proto change

**STOP. Before committing proto changes, you MUST complete ALL steps:**

1. **Classify the change** — additive (minor) or breaking (major) or docs-only (patch)

2. **Read current version**:
   ```bash
   cat <ServiceName>.Contracts/version.json | jq -r '.version'
   ```

3. **Propose version bump to the user**:
   ```
   Proto changes: additive (new field `display_order` in ProductModel)
   Current version: 1.2.0
   Recommended version: 1.3.0 (minor bump)

   Update version.json? [Waiting for user confirmation]
   ```

4. **After user confirms — update version.json IMMEDIATELY**:
   ```bash
   # Update the version field in version.json
   ```

5. **Commit proto changes AND version.json TOGETHER** — in the same commit or at minimum the same branch:
   ```
   feat(contracts): add display_order field to ProductModel

   Refs GZDKH/<repo>#<number>
   ```

### Self-check before pushing

```bash
# Verify version.json was updated in this branch
git diff main -- '**/version.json' | grep '"version"'

# If this returns empty — YOU FORGOT TO BUMP THE VERSION. Fix it now.
```

### Anti-patterns (FORBIDDEN)

| Anti-pattern | Consequence | Fix |
|-------------|-------------|-----|
| Proto changes committed without version.json bump | Package won't publish, need throwaway fix branch | Always bump in same branch |
| Version bump in a separate MR after proto MR is merged | Wasted branch + MR just for version change | Combine in one MR |
| Bumping version without proto changes | Unnecessary publish cycle | Only bump when proto changes |
| Skipping user confirmation for version bump | Wrong version could be published | Always ask, always confirm |
| Bumping patch for additive changes | Consumers won't get new types without explicit upgrade | Use minor for new fields/methods |

### Rules (NON-NEGOTIABLE)

- **NEVER** commit proto changes without a version.json bump in the SAME branch
- **NEVER** auto-bump version without user confirmation
- **ALWAYS** show: current version → recommended version → reason (breaking/additive/patch)
- **ALWAYS** allow user to override the recommended version
- **ALWAYS** verify version.json was modified before creating MR: `git diff main -- '**/version.json'`
- **If you forgot** — fix it immediately in the same branch before MR, do NOT create a separate branch
