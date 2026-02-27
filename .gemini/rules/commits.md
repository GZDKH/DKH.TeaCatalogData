---
description: Commit rules for all GZDKH repositories
globs: "**/*.{cs,csproj,proto,ts,tsx,json,md,yml,yaml}"
---

# Commit rules (MANDATORY)

**Format**: `<type>(<scope>): <summary>` (Conventional Commits 1.0.0)

**Types**: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `build`, `ci`, `perf`, `revert`

**Rules**:
- Imperative mood, max 72 characters
- **NEVER** add `Co-Authored-By`, `Signed-off-by`, or ANY author attribution
- Commit each logical unit immediately after it builds and tests pass
- Do NOT accumulate changes — if you made 2-3 related edits, commit now
- One commit per bug fix, one per feature step, one per refactor step
