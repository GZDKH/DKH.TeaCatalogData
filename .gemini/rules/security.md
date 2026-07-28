<!-- GENERATED FILE — DO NOT EDIT LOCALLY -->
<!-- Source: rules/universal/security.md (in DKH.AgentRules) -->
<!-- To change this rule, edit the source and run: pwsh scripts/sync-claude-rules.ps1 -All -->

---
description: Security rules for all repositories
globs: "**/*"
---

# Security (MANDATORY)

- **NEVER** commit secrets, tokens, passwords, or connection strings
- **NEVER** add credentials to settings.json, CLAUDE.md, or any tracked file
- Use `.env.local`, user-secrets, or CI variables for sensitive values
- If you see a leaked secret — flag it immediately, do not proceed
