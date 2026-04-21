# Import 20 curated teas to production

This package lets you load the 20 prepared tea products into the production ProductCatalogService via AdminGateway.

## Files you have now

| File | Purpose |
|---|---|
| `import/04-products/<REGION>/*.json` × 20 | The product data — one file per tea, grouped by region folder |
| `scripts/import-20-teas.js` | Importer — reads an **explicit manifest** of 20 files, sends each to AdminGateway |
| `scripts/lib/config.js` | Keycloak token helper (unchanged, shared with other scripts) |
| `.env.prod.example` | Env template — copy → `.env`, fill in secrets |

## Before you import

### 1. Create `.env` from the template

```powershell
Copy-Item scripts\env.prod.template .env
```

Open `.env` in an editor and fill in three secrets:

- `KEYCLOAK_CLIENT_SECRET` — from Keycloak Admin UI → realm `dkh` → Clients → `dkh-admin-gateway` → **Credentials** → copy "Client secret"
- `KEYCLOAK_USERNAME` — your admin user in realm `dkh`
- `KEYCLOAK_PASSWORD` — its password

`.env` is gitignored — it will NOT be committed.

### 2. Verify Tailscale VPN is up

```powershell
curl http://10.10.10.101:5005/health
```

Expected: `200 OK`. If not — check Tailscale connection.

### 3. Verify prerequisites exist in prod

The importer sends each JSON as-is; it does **not** pass `ImportOptions` (the AdminGateway DTO doesn't accept them). This means the following must already exist in the production DB:

- **Catalog** `CATALOG-CHINESE-TEA` (currency: CNY)
- **Categories** used in the 20 JSONs:
  `CAT-JASMINE-TEA`, `CAT-WHITE-TEA`, `CAT-WHITE-YINZHEN`, `CAT-GREEN-TEA`, `CAT-GREEN-LONGJING`, `CAT-RED-TEA`, `CAT-RED-JINJUNMEI`, `CAT-RED-LAPSANG`, `CAT-OOLONG-TEA`, `CAT-OOLONG-TAIWAN`, `CAT-OOLONG-TIEGUANYIN`, `CAT-DARK-LIUBAO`, `CAT-REGION-FUJIAN`, `CAT-REGION-TAIWAN`, `CAT-REGION-SICHUAN`, `CAT-REGION-ZHEJIANG`, `CAT-REGION-CHINA`, `CAT-REGION-GUANGXI`, `CAT-SPEC-GONGFU`, `CAT-SPEC-SHOUGONG`, `CAT-SPEC-GAOSHAN`, `CAT-SPEC-SHENGTAI`, `CAT-SPEC-YESHENG`
- **Packages**: `PKG-25G`, `PKG-50G`, `PKG-75G`, `PKG-100G`, `PKG-150G`, `PKG-250G`, `PKG-300G`, `PKG-500G`, `PKG-600G`, `PKG-BASKET-1KG`

If the catalog/categories are missing, import them first from `import/03-categories/categories.json` via the existing `import-reference.js` or through the admin UI. Tags are created automatically during product import.

## Run the import

### Dry-run (recommended first) — validate without writing

```powershell
cd D:\projects\GZDKH\data\DKH.TeaCatalogData
node scripts/import-20-teas.js --dry
```

This calls `/api/v1/data-exchange/import/validate` — the gateway parses and checks each file but does not write to the DB. Output shows OK / PARTIAL / FAILED per tea.

### Real import — all 20

```powershell
node scripts/import-20-teas.js
```

### Import only specific items (e.g. #1 and #6)

```powershell
node scripts/import-20-teas.js --only=1,6
```

The numbers match the order in your original list (1 = Мо Ли Лун Чжу, 20 = Дун Дин Улун).

## What you'll see

```
DKH Tea Import — 20 product(s)
Gateway: http://10.10.10.101:5005

Obtaining Keycloak token...
Token OK.

[ 1] Мо Ли Лун Чжу                   OK (1 processed)
[ 2] Бай Цзянь Бай Ча                OK (1 processed)
...
[20] Дун Дин Улун                    OK (1 processed)

=== SUMMARY ===
OK:      20
PARTIAL: 0
FAILED:  0
TOTAL:   20

Full log: D:\projects\GZDKH\data\DKH.TeaCatalogData\logs\import-2026-04-21....json
```

Every run writes a full JSON log into `logs/` — useful if something fails and needs investigation.

## If something goes wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| `ECONNREFUSED` / `ETIMEDOUT` on Gateway | Tailscale VPN is down | Reconnect, retry |
| HTTP 401 on import call | Wrong Keycloak creds in `.env` | Re-copy client secret, check user/password |
| HTTP 403 on import call | Your user lacks `CatalogImport` policy role | Assign the role in Keycloak realm `dkh` |
| `PARTIAL` with "category not found" | Prerequisite category missing in prod | Import `03-categories/categories.json` first |
| `PARTIAL` with "Product specification attributes support only Option type" | Benign — we don't ship any `CustomText` specs, so this shouldn't trigger | Ignore — product is still created |
| `FAILED` with `HTTP 400` body `"Either file content or sourceUrl must be provided."` | `file` field not attached (broken multipart) | Report — likely a bug |
| Duplicate code → product already exists | `update_existing` is false by default, can't upsert via gateway | Delete the old product first, or use SQL to clean |

## Re-running the import

Because the AdminGateway does not expose `ImportOptions.update_existing`, running the script twice will fail on the second run (code conflict). If you need to re-import, either:

- Delete the existing products via admin UI / API, then re-run
- Or use `--only=N` for items that haven't been created yet
