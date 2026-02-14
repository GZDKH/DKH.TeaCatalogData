---
description: Security rules for all repositories
globs: "**/*"
---

# Security (MANDATORY)

- **NEVER** commit secrets, tokens, passwords, or connection strings
- **NEVER** add credentials to settings.json, CLAUDE.md, or any tracked file
- Use `.env.local`, user-secrets, or CI variables for sensitive values
- If you see a leaked secret — flag it immediately, do not proceed
