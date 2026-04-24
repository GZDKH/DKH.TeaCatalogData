# CLAUDE.md

## Project Overview

DKH.TeaCatalogData is a data repository for tea product documentation and import files for ProductCatalogService.

## Structure

```
DKH.TeaCatalogData/
├── docs/data/products/        # MD files with tea product documentation (~600 files, 35 regions)
│   ├── CHINA-GREEN TEA/       # Region subfolder
│   ├── JAPAN/
│   ├── INDIA/
│   └── ...                    # 35 region folders total
├── import/                    # JSON files for import via ProductCatalogService DataExchange API
│   ├── 01-reference/          # Catalogs, tags, brands, packages
│   ├── 02-specifications/     # Groups → attributes → options
│   ├── 03-categories/         # Categories hierarchy
│   └── 04-products/           # Products (mirrors docs/data/products/ folder structure)
│       ├── CHINA-GREEN TEA/   # Same region subfolders as source MD
│       ├── JAPAN/
│       └── ...
├── scripts/                   # PowerShell scripts for conversion and import
└── .claude/rules/             # Agent rules for MD→JSON conversion
```

## Locales

All translations use BCP 47 locale codes (aligned with ReferenceService):
- **ru-RU** — Russian (primary content language, MD source)
- **en-US** — English (translated)
- **zh-CN** — Simplified Chinese (translated, tea names from MD parentheses)

## MD File Format

Each MD file in `docs/data/products/<REGION>/` describes one tea product. Files have 13–22 numbered sections in Russian. Core sections (present in most files):

1. Классификация и Происхождение
2. История и Культурное Значение
3. Ботаническое Описание и Сырьё
4. Терруар и Особенности Выращивания
5. Технология Производства
6. Органолептические Характеристики
7. Химический Состав
8. Полезные Свойства
9. Заваривание
10. Хранение
11. Цена и Подделки
12. Интересные Факты
13–22. Extended sections (Разновидности, Прессовка, Выдержка, Вода и посуда, Дегустация, FAQ, etc.)

File naming: `+# <Name>.md` (China/Flowers) or `# <Name>.md` (other regions).

See `.claude/rules/md-to-import-json.md` for complete conversion rules.

## JSON Import Format

Products JSON uses ProductCatalogService DataExchange schema. One file = one product = single-element array `[{ ... }]`.

```json
[
  {
    "code": "TEA-CN-XIHU-LONGJING",
    "sku": "XLJ-ZJ-2024-50G",
    "published": true,

    "brand": {
      "code": "BRAND-XIHU",
      "translations": [
        { "lang": "en-US", "name": "Xihu Tea" },
        { "lang": "ru-RU", "name": "Сиху Чай" }
      ]
    },

    "translations": [
      { "lang": "ru-RU", "name": "...", "description": "...", "seo": "...", "metaDescription": "...", "metaTitle": "..." },
      { "lang": "en-US", "name": "...", "description": "...", "seo": "..." },
      { "lang": "zh-CN", "name": "西湖龙井", "description": "...", "seo": "..." }
    ],

    "catalogs": [
      {
        "catalog": { "code": "CATALOG-CHINESE-TEA", "currency": "CNY",
          "translations": [{ "lang": "en-US", "name": "Chinese Tea" }, { "lang": "ru-RU", "name": "Китайский чай" }] },
        "category": { "code": "CAT-GREEN-TEA", "parent": "CAT-TEA",
          "translations": [{ "lang": "en-US", "name": "Green Tea" }, { "lang": "ru-RU", "name": "Зелёный чай" }] },
        "order": 1, "published": true
      }
    ],

    "packages": [
      { "package": "PKG-50G", "packageName": "50g", "packageUnit": "g", "quantity": 1, "default": true }
    ],

    "tags": [
      { "code": "TAG-SINGLE-ORIGIN", "name": "Single Origin", "lang": "en-US" }
    ],

    "specifications": [
      { "lang": "en-US", "group": "SPEC-GROUP-CLASSIFICATION", "groupName": "Classification and Origin",
        "attribute": "SPEC-TEA-TYPE", "attributeName": "Tea Type",
        "option": "SPEC-TYPE-GREEN", "optionName": "Green Tea",
        "type": "Option", "showOnPage": true, "order": 1 }
    ],

    "origins": [
      { "country": "CN", "state": "Zhejiang", "city": "Hangzhou",
        "altitude": { "min": 100, "max": 800, "unit": "m" },
        "coordinates": { "lat": 30.229, "lng": 120.108 },
        "translations": [
          { "lang": "en-US", "place": "Xihu District, Hangzhou", "notes": "..." },
          { "lang": "ru-RU", "place": "Район Сиху, Ханчжоу", "notes": "..." }
        ]
      }
    ]
  }
]
```

**Not populated from MD** (no source data): `price`, `tierPrices`, `catalogPrices`, `media`, `related`, `crossSells`, availability/marketing fields.

## Import Order

1. `01-reference/` — catalogs, tags, brands, packages
2. `02-specifications/` — groups → attributes → options
3. `03-categories/` — categories hierarchy
4. `04-products/<REGION>/` — products by region (mirrors `docs/data/products/` folder structure)

## Related

- [ProductCatalogService import examples](https://github.com/GZDKH/DKH.ProductCatalogService/tree/main/docs/data-exchange/examples)
- [ProductCatalogService source](https://github.com/GZDKH/DKH.ProductCatalogService)

## Commands

```powershell
# Import to ProductCatalogService via gRPC
./import-grpc.ps1 -Profile "products" -FilePath ./import/04-products/<file>.json

# Simple import (no field transformation)
./do-import.ps1 -Profile "products" -FilePath ./import/04-products/<file>.json
```
