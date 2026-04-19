<!-- GENERATED FILE — DO NOT EDIT LOCALLY -->
<!-- Source: rules/on-demand/platform-release.md (in DKH.AgentRules) -->
<!-- To change this rule, edit the source and run: pwsh scripts/sync-claude-rules.ps1 -All -->

---
description: DKH.Platform NuGet release workflow — CI handles versioning/publishing automatically; agent only writes correctly-scoped commits
globs: "**/*"
alwaysApply: true
---

# DKH.Platform Release Workflow (MANDATORY)

## Core Rule: CI does everything. Agent just writes commits with correct scope.

As of 2026-04-13 (GZDKH/DKH.Platform#284), the release process is **fully automated by CI**:

1. Agent merges a Conventional Commit MR to `main`.
2. CI job `auto-version-bump` runs `auto-version.ps1` against the latest `release-*` tag. If any scope maps to a package, it creates a short-lived MR `chore(versions): auto-bump from conventional commits` with `merge_when_pipeline_succeeds`.
3. That bump MR's pipeline runs build/test/lint; on success it auto-merges.
4. CI job `publish-nuget` detects the auto-bump merge, tags `release-<pipeline-id>`, packs, and pushes every bumped `.nupkg` to the GitLab NuGet registry.
5. CI job `sync-consumer-versions` opens auto-bump MRs in every consumer repo (services/gateways/workers) updating their `Directory.Packages.props`.

**No manual steps.** Do NOT edit `versions.json`. Do NOT run `auto-version.ps1 -Force` locally. Do NOT tag `release-*` manually.

## When This Rule Applies

Any change to a `DKH.Platform.*` library's source code or public API.

## Agent's ONE Job: Correct Commit Scope

The scope in every `DKH.Platform` commit **MUST map to a package** — otherwise `auto-version.ps1` silently skips the bump and the new code never reaches consumers.

### Valid scopes (auto-derived from `versions.json`)

For each package `DKH.Platform.<Suffix>`, these scope forms work:
- **Dotted, lowercased**: strip `DKH.Platform.` prefix and lowercase → `logging`, `grpc.client`, `entityframeworkcore.postgresql`
- **Kebab-case** (dots → hyphens): `grpc-client`, `entityframeworkcore-postgresql`
- **Single segment** (when not ambiguous): `logging`, `redis`, `caching`, `identity`, `outbox`, `http`, `grpc`

Special case: the root wrapper `DKH.Platform` uses scope `platform`.

### Examples

```
feat(logging): add structured context enricher       → bumps DKH.Platform.Logging (minor)
fix(redis): correct connection pool leak             → bumps DKH.Platform.Redis (patch)
refactor(grpc-client): simplify retry logic          → bumps DKH.Platform.Grpc.Client (patch)
perf(entityframeworkcore): optimize query planner    → bumps DKH.Platform.EntityFrameworkCore (patch)
feat(http)!: drop ObsoleteMiddleware — BREAKING      → bumps DKH.Platform.Http (MAJOR)
```

### Bump-level rules

| Commit type / marker | Bump | Notes |
|---|---|---|
| `feat(scope):` | minor | New public API |
| `fix/refactor/chore/perf/build/revert(scope):` | patch | |
| `!` after type OR `BREAKING CHANGE:` in body | major | Overrides other levels |
| Intermediate package in a bumped dependency chain | patch | Auto — "bridge cascade" |

### Infrastructure scopes — **intentionally skipped**

`ci`, `build`, `scripts`, `docs`, `versions`, `sln`, `deps`, `config`, `release`, `structure`, `workflow`, `github`

Use these for non-code changes (CI edits, root documentation, tooling). They never trigger a bump.

### Test-only changes — auto-detected and skipped

If all changed files are under `tests/`, no bump is triggered regardless of the scope. A `test(caching): ...` commit that only touches `tests/` will NOT bump `DKH.Platform.Caching`.

## Previewing Bumps Locally (OPTIONAL)

Only for sanity-checking — never commit the output:

```bash
cd <DKH.Platform-path>
# Find the latest release tag
LAST_TAG=$(git tag -l 'release-*' --sort=-version:refname | head -1)

# Preview what CI would bump
pwsh .scripts/auto-version.ps1 -FromTag "$LAST_TAG" -DryRun
```

Output shows direct bumps and bridge-cascade bumps. If you expected a package to be bumped but it's missing, check the commit scope.

## Consumer Projects (services/gateways/workers)

Do **NOT** manually bump `Directory.Packages.props`. After every Platform release, CI's `sync-consumer-versions` opens a `chore/auto-bump-platform-versions` MR in each consumer repo. Review and let auto-merge finish it.

If you ever need a hotfix bump for just one package before the next Platform release, open a regular MR that edits `Directory.Packages.props` — but this should be rare.

## Post-Release: GitHub Release Notes (OPTIONAL, for humans)

After CI creates a new `release-<N>` tag, the corresponding GitHub Release can be enriched with a detailed changelog. This is optional; the tag + published packages are what consumers rely on.

If updating: `gh release edit release-<N> --repo GZDKH/DKH.Platform --notes "..."` with Features/Fixes sections grouped from commits in the release range.

## Anti-patterns (FORBIDDEN)

| Anti-pattern | Consequence | Fix |
|---|---|---|
| Editing `versions.json` directly in an MR | Will be overwritten by CI, or conflict with auto-bump MR | Let CI handle it — just commit with correct scope |
| Running `auto-version.ps1 -Force` locally and committing the result | Duplicate bump MR conflicts with CI's own | Preview with `-DryRun`, never `-Force` |
| Using scope that doesn't map to a package (e.g. `feat(cache)` instead of `feat(caching)`) | Silent skip — code ships without bump, consumers can't pick it up | Match the scope to the package suffix from `versions.json` |
| Using infra scope (`ci`, `docs`, etc.) for actual code change | Skipped — no bump | Use the library scope even if the change also touches CI |
| Creating `release-*` tag manually | Conflicts with CI's next auto-tag; may break `auto-version.ps1` reference point | Never tag manually |
| Manually updating consumer `Directory.Packages.props` after Platform merge | Conflicts with `sync-consumer-versions` MR | Let CI's consumer-sync MR do it |

## Rules (NON-NEGOTIABLE)

- **NEVER** edit `versions.json` — CI's `auto-version-bump` is the only writer
- **NEVER** run `auto-version.ps1 -Force` locally; `-DryRun` only
- **NEVER** create or delete `release-*` tags manually
- **ALWAYS** use a scope that maps to a package (see "Valid scopes" above)
- **ALWAYS** include `BREAKING CHANGE:` footer or `!` marker when removing/changing public API — this is how CI detects major bumps
- **ALWAYS** verify the auto-bump MR created by CI before it auto-merges (catch surprises early — wrong bump levels, missed packages)

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| CI merged your MR but no auto-bump MR appeared | Scope didn't map to any package, or all your commits were infra-scoped, or changes were test-only | Open a small follow-up MR with a correctly-scoped `fix` commit touching a source file in the intended package |
| Auto-bump MR created but packages didn't publish after it merged | `publish-nuget` job failed — check pipeline on `main` at the merge commit | Inspect job log; re-run if transient. If `CI_PUSH_TOKEN` expired, rotate it (see group access tokens in GitLab settings) |
| Consumer `sync-consumer-versions` fails to create MRs | Token/permissions issue in consumer repo | Check job log for the now-visible stderr; verify group token has Maintainer role on the target repo |
| `auto-version.ps1 -DryRun` locally disagrees with what CI produced | Local `versions.json` is out of sync with `main`, or you're running from a different reference tag | Pull main + use the latest `release-*` tag with `-FromTag` |
