<!-- GENERATED FILE — DO NOT EDIT LOCALLY -->
<!-- Source: rules/universal/prod-debugging.md (in DKH.AgentRules) -->
<!-- To change this rule, edit the source and run: pwsh scripts/sync-claude-rules.ps1 -All -->

---
description: Production debugging — logs first, then code
globs: "**/*"
alwaysApply: true
---

# Production Debugging (MANDATORY)

When a user reports a production issue:

## Step 1: LOGS FIRST (BLOCKING)

**BEFORE looking at code**, check production logs:

```bash
ssh dkh-apps 'docker logs <container> --since 10m 2>&1 | grep -iE "error|fail|warn|exception" | tail -30'
```

Logs tell you WHAT is actually happening. Code tells you what SHOULD happen. Start with reality.

## Step 2: Identify the actual error

- `Connection refused` → service/dependency is down or misconfigured
- `401/403` → auth/permissions issue
- `500` → application error — read full stack trace
- `404` → wrong URL/endpoint
- No errors → issue is on the client side (check browser/UI logs)

## Step 3: Fix the root cause, not the symptom

- If config is wrong → fix config, not code
- If a service is down → fix the service, not add fallbacks
- If auth tokens are missing claims → fix the token issuer, not the consumer

## Rules (NON-NEGOTIABLE)

- **NEVER** guess the cause — always check logs first
- **NEVER** make code changes to work around a config/infra issue
- **NEVER** apply "try this and see" patches — understand the error first
- **ALWAYS** read the FULL stack trace, not just the error message
- **ALWAYS** check if the issue is config (env files, SOPS) before touching code
