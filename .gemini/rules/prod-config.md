<!-- GENERATED FILE — DO NOT EDIT LOCALLY -->
<!-- Source: rules/on-demand/prod-config.md (in DKH.AgentRules) -->
<!-- To change this rule, edit the source and run: pwsh scripts/sync-claude-rules.ps1 -All -->

---
description: Production configuration must be updated alongside code changes — BLOCKING
globs: "**/*"
alwaysApply: false
---

# Production Configuration Sync (BLOCKING — MANDATORY)

**CRITICAL**: When adding ANY configuration-dependent code, you MUST update ALL configuration layers **in the same branch/MR**. Forgetting to update Docker Compose env files is the #1 cause of broken deployments — the service starts but crashes because the config key doesn't exist in the container environment.

## What triggers this rule

Any change that introduces a new configuration dependency:

### .NET services and gateways

- New gRPC client registration (`grpc.AddEndpointFromConfiguration<TClient>()`)
- New `Platform:*` config section (cache, auth, storage, etc.)
- New connection string
- New environment variable referenced in code
- New external service URL or feature flag

### Next.js / React UI

- New `NEXT_PUBLIC_*` environment variable
- New build-time variable in `Dockerfile` (`ARG`)
- New runtime config key
- New API endpoint URL or feature toggle

## Required configuration layers

### For .NET services/gateways — ALL 3 layers are MANDATORY

#### Layer 1: appsettings.json (local dev — in service repo)

```json
"Platform": {
  "Grpc": {
    "Endpoints": {
      "NewServiceClient": {
        "Url": "https://localhost:5009",
        "TimeoutSeconds": 30
      }
    }
  }
}
```

#### Layer 2: Docker Compose env files (in DKH.Infrastructure repo)

**CRITICAL**: This is the step that gets forgotten most often. You MUST update env files in `DKH.Infrastructure/docker-compose/env/`.

**File structure:**

```
DKH.Infrastructure/docker-compose/
├── env/                          ← Base env files (local Docker dev)
│   ├── common.env                ← Shared by ALL services
│   ├── <service-name>.env        ← Service-specific config
│   └── ...
├── env/prod/                     ← Production overrides
│   ├── common.env                ← Production-wide overrides
│   ├── <service-name>.env        ← Service-specific production overrides
│   └── ...
└── env/local/                    ← Personal overrides (gitignored)
```

**Service → env file mapping:**

| Service / Gateway | Base env file | Prod override |
|-------------------|---------------|---------------|
| TelegramBotService | `env/telegram-bot-service.env` | `env/prod/telegram-bot-service.env` |
| TelegramClientService | `env/telegram-client-service.env` | `env/prod/telegram-client-service.env` |
| NotificationService | `env/notification-service.env` | `env/prod/notification-service.env` |
| ProductCatalogService | `env/product-catalog-service.env` | `env/prod/product-catalog-service.env` |
| ReferenceService | `env/reference-service.env` | `env/prod/reference-service.env` |
| OrderService | `env/order-service.env` | `env/prod/order-service.env` |
| CartService | `env/cart-service.env` | `env/prod/cart-service.env` |
| StorefrontService | `env/storefront-service.env` | `env/prod/storefront-service.env` |
| CustomerService | `env/customer-service.env` | `env/prod/customer-service.env` |
| ReviewService | `env/review-service.env` | `env/prod/review-service.env` |
| ApiManagementService | `env/api-management-service.env` | `env/prod/api-management-service.env` |
| InventoryService | `env/inventory-service.env` | `env/prod/inventory-service.env` |
| BroadcastService | `env/broadcast-service.env` | `env/prod/broadcast-service.env` |
| AdminGateway | `env/admin-gateway.env` | `env/prod/admin-gateway.env` |
| StorefrontGateway | `env/storefront-gateway.env` | `env/prod/storefront-gateway.env` |
| McpGateway | `env/mcp-gateway.env` | `env/prod/mcp-gateway.env` |

**When to update which file:**

| Scenario | Update base `env/` | Update `env/prod/` |
|----------|-------------------|-------------------|
| New gRPC client endpoint | ✅ (with Docker container name) | ✅ (if container name differs in prod) |
| New Platform config section | ✅ | ✅ (if different in prod) |
| New connection string | ❌ (usually from .env.local) | ❌ (from SOPS secrets) |
| New feature flag | ✅ | ✅ (if different in prod) |

**Example — adding a new gRPC client to AdminGateway:**

```bash
# In DKH.Infrastructure/docker-compose/env/admin-gateway.env, ADD:
Platform__Grpc__Endpoints__NewServiceClient__Url=http://new-service:5020

# In DKH.Infrastructure/docker-compose/env/prod/admin-gateway.env, ADD:
Platform__Grpc__Endpoints__NewServiceClient__Url=http://new-service:5020
```

**Docker container name convention:**

| Service | Container name | Internal port |
|---------|---------------|---------------|
| ProductCatalogService | `product-catalog-service` | 5003 |
| ReferenceService | `reference-service` | 5004 |
| AdminGateway | `admin-gateway` | 5005 |
| StorefrontGateway | `storefront-gateway` | 5006 |
| OrderService | `order-service` | 5007 |
| CartService | `cart-service` | 5008 |
| StorefrontService | `storefront-service` | 5009 |
| CustomerService | `customer-service` | 5010 |
| ReviewService | `review-service` | 5011 |
| ApiManagementService | `api-management-service` | 5012 |
| InventoryService | `inventory-service` | 5014 |
| TelegramClientService | `telegram-client-service` | 5015 |
| BroadcastService | `broadcast-service` | 5016 |
| TelegramBotService | `telegram-bot-service` | 5001 |
| NotificationService | `notification-service` | 5002 |

**gRPC endpoint URL format in env files:**
```
Platform__Grpc__Endpoints__<ClientName>__Url=http://<container-name>:<port>
```

#### Layer 3: Production server env files (via SSH)

**CRITICAL**: SSH and add config to production env files:

```bash
ssh dkh-apps
# Base env
echo 'Platform__Grpc__Endpoints__NewServiceClient__Url=http://new-service:5020' | sudo tee -a /opt/dkh/env/<service>.env
# Production override
echo 'Platform__Grpc__Endpoints__NewServiceClient__Url=http://new-service:5020' | sudo tee -a /opt/dkh/env/prod/<service>.env
```

Then recreate the container using the wrapper script (loads both `.env.local` and `.env.prod`):

```bash
cd /opt/dkh && sudo ./dkh-compose.sh up -d --no-deps --force-recreate <service-name>
```

**NEVER** use `docker compose --env-file .env.local` directly — it misses secrets from `.env.prod`. Always use `dkh-compose.sh` or pass both env files: `--env-file .env.local --env-file .env.prod`.

### For Next.js / React UI

#### 1. .env.example (local dev)

```bash
NEXT_PUBLIC_NEW_FEATURE=value
```

#### 2. Dockerfile ARG (if build-time)

```dockerfile
ARG NEXT_PUBLIC_NEW_FEATURE
ENV NEXT_PUBLIC_NEW_FEATURE=${NEXT_PUBLIC_NEW_FEATURE}
```

#### 3. docker-compose.services.yml in DKH.Infrastructure

Add to the UI service's `build.args` section:

```yaml
build:
  args:
    - NEXT_PUBLIC_NEW_FEATURE=${NEXT_PUBLIC_NEW_FEATURE}
```

#### 4. GitLab CI variables

Add `--build-arg NEXT_PUBLIC_NEW_FEATURE=${NEXT_PUBLIC_NEW_FEATURE}` to `.gitlab-ci.yml` `DOCKER_BUILD_ARGS`.

### For secrets (passwords, tokens, connection strings)

Use **SOPS** to manage encrypted production secrets in `DKH.Infrastructure/docker-compose/.env.prod.enc`:

```bash
cd DKH.Infrastructure
# Edit encrypted secrets (decrypts → opens $EDITOR → re-encrypts)
pwsh -File scripts/secrets.ps1 edit
# Or directly
sops edit --input-type dotenv --output-type dotenv docker-compose/.env.prod.enc
```

After editing, commit the encrypted file:

```bash
git add docker-compose/.env.prod.enc
git commit -m "chore(secrets): add NEW_SECRET_VARIABLE"
```

CI/CD auto-syncs `.env.prod.enc` to `/opt/dkh/.env.local` on the server when changes land on `main`.

**NEVER** add secrets directly to `/opt/dkh/.env.local` on the server — they will be overwritten on next deploy. Always use SOPS.

## Self-check before creating MR (BLOCKING)

After implementing config-dependent code, verify ALL layers:

```bash
# 1. Check appsettings.json has the new key
grep -r "NewServiceClient" <ServiceName>.Api/appsettings.json

# 2. Check DKH.Infrastructure env file has the new key
grep -r "NewServiceClient" /path/to/DKH.Infrastructure/docker-compose/env/<service>.env

# 3. Check prod env file has the new key
grep -r "NewServiceClient" /path/to/DKH.Infrastructure/docker-compose/env/prod/<service>.env

# If ANY grep returns empty — you MUST add the missing config before MR.
```

## Common config patterns

| Code pattern | Config needed | Where |
|-------------|---------------|-------|
| `grpc.AddEndpointFromConfiguration<TClient>()` | `Platform__Grpc__Endpoints__<ClientName>__Url` | appsettings + env/ + env/prod/ |
| `AddPlatformPostgreSql<T>(connectionName)` | `ConnectionStrings__<Name>` | appsettings + SOPS (.env.prod.enc) |
| `AddPlatformCache(c => c.UseRedis())` | `Platform__Cache__Redis__*` | appsettings + env/ |
| `AddPlatformKeycloakAuth()` | `Platform__Auth__Keycloak__*` | appsettings + env/ + SOPS |
| `configuration["Platform:NewSection:Key"]` | `Platform__NewSection__Key` | appsettings + env/ + env/prod/ |
| `process.env.NEXT_PUBLIC_*` | Dockerfile ARG + docker-compose build args | .env.example + Dockerfile + compose |

## Pre-MR Checklist (MUST complete — BLOCKING)

- [ ] **appsettings.json** updated with new config key (local dev)
- [ ] **DKH.Infrastructure `env/<service>.env`** updated (Docker dev)
- [ ] **DKH.Infrastructure `env/prod/<service>.env`** updated (production)
- [ ] **Production server** `/opt/dkh/env/` updated via SSH (if deploying now)
- [ ] **SOPS secrets** updated if new secret added (`pwsh scripts/secrets.ps1 edit`)
- [ ] **docker-compose.services.yml** updated if new UI build arg
- [ ] **`.env.template`** updated in DKH.Infrastructure (if new shared variable)

## Anti-patterns (FORBIDDEN)

| Anti-pattern | Consequence | Fix |
|-------------|-------------|-----|
| Register gRPC client without env file update | Service crashes on Docker startup — config key not found | Update env/ AND env/prod/ in same branch |
| Add `NEXT_PUBLIC_*` without Dockerfile ARG | Variable is undefined at build time, feature broken | Add to Dockerfile + compose build args |
| Update appsettings.json but forget DKH.Infrastructure env files | Works locally (dotnet run) but crashes in Docker | Always update both repos in same task |
| Add config to env/ but forget env/prod/ | Works in Docker dev but crashes in production | Always update both directories |
| Hardcode service URLs in code instead of config | Breaks when service moves or port changes | Always use `Platform:Grpc:Endpoints` config |
| Add connection string to env file instead of SOPS | Secret exposed in plaintext git history | Use SOPS for secrets, env files for non-sensitive config |

## Cross-repo commit workflow

When a change requires updates in BOTH the service repo AND DKH.Infrastructure:

1. **Service repo** — implement feature, update appsettings.json, commit
2. **DKH.Infrastructure** — update env files, commit:
   ```
   chore(env): add <ClientName> endpoint for <ServiceName>

   Refs GZDKH/<service-repo>#<number>
   ```
3. Both repos should reference the same GitHub issue
