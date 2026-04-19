<!-- GENERATED FILE — DO NOT EDIT LOCALLY -->
<!-- Source: rules/dotnet/no-duplication.md (in DKH.AgentRules) -->
<!-- To change this rule, edit the source and run: pwsh scripts/sync-claude-rules.ps1 -All -->

---
description: Do not duplicate DKH.Platform functionality
globs: "**/*.cs"
paths: ["**/*.cs"]
---

# No infrastructure duplication (MANDATORY)

Before writing ANY infrastructure code:

1. **Check DKH.Platform** for existing abstractions first
2. Use `AddPlatform*()` extension methods — **NEVER** manual DI registration
3. Use `Platform.CreateWeb(args)` or `Platform.Create(args)` entry point

**Anti-patterns** (NEVER do these):
- `services.AddDbContext<T>()` directly — use `AddPlatformPostgreSql<T>()`
- `services.AddMediatR()` directly — use `AddPlatformMessagingWithMediatR()`
- `services.AddSwaggerGen()` — use `AddPlatformRestfulApi()`
- `services.AddAuthentication().AddJwtBearer()` — use `AddPlatformKeycloakAuth()`
- Manual `Serilog.Log.Logger` setup — use `AddPlatformLogging()`
