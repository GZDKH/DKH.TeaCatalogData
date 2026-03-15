# DKH.TeaCatalogData

Tea product documentation (MD) and import data (JSON) for ProductCatalogService.

## Structure

```
DKH.TeaCatalogData/
├── docs/data/products/            # MD files with tea documentation (~600 files, 35 regions)
│   ├── CHINA-GREEN TEA/
│   ├── CHINA-WHITE TEA/
│   ├── CHINA-OOLONG TEA/
│   ├── JAPAN/
│   ├── INDIA/
│   └── ... (35 regions)
├── import/                        # JSON files for import
│   ├── 01-reference/              # Catalogs, tags, brands, packages
│   ├── 02-specifications/         # Groups → attributes → options
│   ├── 03-categories/             # Category hierarchy
│   └── 04-products/               # Products (one file = one product)
├── scripts/                       # PowerShell scripts
├── .claude/rules/                 # Agent rules (MD→JSON conversion)
│   └── md-to-import-json.md       # Complete conversion guide
└── CLAUDE.md                      # Agent context
```

## Locales

BCP 47 locale codes (aligned with ReferenceService):

- **ru-RU** — Russian (MD source language)
- **en-US** — English
- **zh-CN** — Simplified Chinese

## Import Order

Import in this exact order (foreign key dependencies):

1. `01-reference/` — catalogs, tags, brands, packages
2. `02-specifications/` — groups → attributes → options
3. `03-categories/` — categories hierarchy
4. `04-products/` — products (one file per product)

## Product JSON Format

One file = one product = single-element array. Auto-creates brands, manufacturers, catalogs, categories, tags, packages, and specification groups/attributes/options if they don't exist.

```json
[
  {
    "code": "TEA-CN-XIHU-LONGJING",
    "sku": "XLJ-ZJ-2024-50G",
    "order": 1,
    "published": true,

    "brand": {
      "code": "BRAND-XIHU",
      "translations": [
        { "lang": "en-US", "name": "Xihu Tea" },
        { "lang": "ru-RU", "name": "Сиху Чай" },
        { "lang": "zh-CN", "name": "西湖茶" }
      ]
    },

    "manufacturer": {
      "code": "MFR-SHIFENG",
      "translations": [
        { "lang": "en-US", "name": "Shifeng Peak Tea Factory" },
        { "lang": "ru-RU", "name": "Чайная фабрика Шифэн" }
      ]
    },

    "translations": [
      {
        "lang": "ru-RU",
        "name": "Си Ху Лун Цзин (西湖龙井)",
        "description": "...",
        "seo": "si-khu-lun-tszin",
        "metaDescription": "...",
        "metaTitle": "..."
      },
      { "lang": "en-US", "name": "Xihu Longjing", "description": "...", "seo": "xihu-longjing" },
      { "lang": "zh-CN", "name": "西湖龙井", "description": "...", "seo": "xihu-longjing" }
    ],

    "catalogs": [
      {
        "catalog": {
          "code": "CATALOG-CHINESE-TEA", "currency": "CNY",
          "translations": [
            { "lang": "en-US", "name": "Chinese Tea" },
            { "lang": "ru-RU", "name": "Китайский чай" },
            { "lang": "zh-CN", "name": "中国茶" }
          ]
        },
        "category": {
          "code": "CAT-GREEN-TEA", "parent": "CAT-TEA",
          "translations": [
            { "lang": "en-US", "name": "Green Tea" },
            { "lang": "ru-RU", "name": "Зелёный чай" },
            { "lang": "zh-CN", "name": "绿茶" }
          ]
        },
        "order": 1, "published": true
      }
    ],

    "packages": [
      { "package": "PKG-50G", "packageName": "50g", "packageUnit": "g", "quantity": 1, "default": true }
    ],

    "tags": [
      { "code": "TAG-TOP10-CHINA", "name": "Top 10 Famous Teas of China", "lang": "en-US" },
      { "code": "TAG-SINGLE-ORIGIN", "name": "Single Origin", "lang": "en-US" }
    ],

    "specifications": [
      {
        "lang": "en-US",
        "group": "SPEC-GROUP-CLASSIFICATION", "groupName": "Classification and Origin",
        "attribute": "SPEC-TEA-TYPE", "attributeName": "Tea Type",
        "option": "SPEC-TYPE-GREEN", "optionName": "Green Tea",
        "type": "Option", "showOnPage": true, "order": 1
      },
      {
        "lang": "en-US",
        "group": "SPEC-GROUP-PROCESSING", "groupName": "Production Technology",
        "attribute": "SPEC-FERMENTATION", "attributeName": "Fermentation Level",
        "option": "SPEC-FERM-0", "optionName": "0% (Unfermented)",
        "type": "Option", "showOnPage": true, "order": 11
      },
      {
        "lang": "en-US",
        "group": "SPEC-GROUP-ORGANOLEPTIC", "groupName": "Organoleptic Characteristics",
        "attribute": "SPEC-AROMA", "attributeName": "Aroma",
        "option": "SPEC-AROMA-NUTTY", "optionName": "Nutty / Chestnut",
        "type": "Option", "showOnPage": true, "order": 46
      },
      {
        "lang": "en-US",
        "group": "SPEC-GROUP-BREWING", "groupName": "Brewing",
        "attribute": "SPEC-BREW-TEMP", "attributeName": "Water Temperature (°C)",
        "type": "Number", "value": "80",
        "showOnPage": true, "order": 66
      }
    ],

    "origins": [
      {
        "country": "CN", "state": "Zhejiang", "city": "Hangzhou",
        "altitude": { "min": 100, "max": 800, "unit": "m" },
        "coordinates": { "lat": 30.229, "lng": 120.108 },
        "translations": [
          { "lang": "en-US", "place": "Xihu District, Hangzhou", "notes": "Red/yellow soils, subtropical climate" },
          { "lang": "ru-RU", "place": "Район Сиху, Ханчжоу", "notes": "Красные и жёлтые почвы, субтропический климат" }
        ]
      }
    ]
  }
]
```

**Not populated from MD** (no source): `price`, `tierPrices`, `catalogPrices`, `media`, `related`, `crossSells`.

## MD File Format

Each MD file has 13–22 numbered sections in Russian. Every section maps to a specification group. See `.claude/rules/md-to-import-json.md` for complete mapping rules.

## Commands

```powershell
# Import via gRPC (with field transformation)
./import-grpc.ps1 -Profile "products" -FilePath ./import/04-products/<file>.json

# Simple import (no transformation)
./do-import.ps1 -Profile "products" -FilePath ./import/04-products/<file>.json
```

## Related

| Repository | Description |
|---|---|
| [DKH.ProductCatalogService](https://github.com/GZDKH/DKH.ProductCatalogService) | Consumes import JSON via gRPC DataExchange API |
| [DKH.Architecture](https://github.com/GZDKH/DKH.Architecture) | Architecture docs and agent rules |

## License

Proprietary — GZDKH Project
