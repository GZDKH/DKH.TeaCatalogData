<!-- GENERATED FILE — DO NOT EDIT LOCALLY -->
<!-- Source: rules/dotnet/build-gates.md (in DKH.AgentRules) -->
<!-- To change this rule, edit the source and run: pwsh scripts/sync-claude-rules.ps1 -All -->

---
description: Build verification before committing — .NET and Next.js quality gates
globs: "**/*.{cs,csproj,ts,tsx,js,jsx}"
paths: ["**/*.cs", "**/*.csproj", "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"]
---

# Build gating (MANDATORY)

## .NET projects

Before EVERY commit:

1. `dotnet format --verify-no-changes` — STOP if fails, fix with `dotnet format`
2. `dotnet build -c Release` — STOP if fails
3. `dotnet test` — STOP if tests fail

## Next.js / React projects

Before EVERY commit:

1. `pnpm lint --fix` — fix lint issues
2. `pnpm build` — STOP if fails

## Rules

- **NEVER** commit code that does not build, has failing tests, or lint errors
- **Blocking** gates (build, test) = must pass before commit
- **Non-blocking** gates (format, lint) = fix before push
- Run gates per-project, not monorepo-wide
- If a gate fails, fix the root cause — do not bypass
