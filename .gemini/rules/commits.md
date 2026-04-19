<!-- GENERATED FILE — DO NOT EDIT LOCALLY -->
<!-- Source: rules/universal/commits.md (in DKH.AgentRules) -->
<!-- To change this rule, edit the source and run: pwsh scripts/sync-claude-rules.ps1 -All -->

---
description: Commit rules for all GZDKH repositories
globs: "**/*.{cs,csproj,proto,ts,tsx,json,md,yml,yaml}"
paths: ["**/*.cs", "**/*.csproj", "**/*.proto", "**/*.ts", "**/*.tsx", "**/*.json", "**/*.md", "**/*.yml", "**/*.yaml"]
---

# Commit rules (MANDATORY)

**Format**: `<type>(<scope>): <summary>` (Conventional Commits 1.0.0)

**Types**: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `build`, `ci`, `perf`, `revert`

**Rules**:
- Imperative mood, max 72 characters
- **NEVER** manually add `Co-Authored-By`, `Signed-off-by`, or ANY author attribution in commit messages — attribution is handled automatically by `settings.json` `attribution` field
- Commit each logical unit immediately after it builds and tests pass
- Do NOT accumulate changes — if you made 2-3 related edits, commit now
- One commit per bug fix, one per feature step, one per refactor step

## Scope requirement in DKH.Platform (BLOCKING)

When committing to `DKH.Platform` repo, the **scope MUST map to a package name** — CI's `auto-version.ps1` uses the scope to route version bumps. Wrong scope → package does not get bumped → new code is never published.

**Valid scope formats** (auto-generated from `versions.json`):
- **Dotted**: `grpc.client`, `entityframeworkcore.postgresql`
- **Kebab**: `grpc-client`, `entityframeworkcore-postgresql`
- **Single segment** (when unambiguous): `logging`, `redis`, `caching`, `outbox`, `identity`, `http`, `grpc`

**Examples** (✓ correct):
```
feat(logging): add structured context enricher
fix(redis): correct connection pool leak
refactor(grpc-client): simplify retry logic
perf(entityframeworkcore): optimize query planner
```

**Anti-patterns** (✗ wrong — bump skipped):
```
feat: something                  # no scope → skipped
feat(foobar): ...                # scope does not map to any package → skipped
feat(minimal-api): ...           # use "minimalapi" (no hyphen) — must match versions.json key suffix
```

**Reserved infra scopes** (skip bump intentionally):
`ci`, `build`, `scripts`, `docs`, `versions`, `sln`, `deps`, `config`, `release`, `structure`, `workflow`, `github`

**Test-only changes** (files only under `tests/`) are auto-detected and skipped regardless of scope.

If unsure, preview locally:
```bash
pwsh <DKH.Platform-path>/.scripts/auto-version.ps1 -DryRun
```
