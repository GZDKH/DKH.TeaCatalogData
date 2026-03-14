# MD-to-Import-JSON Conversion (MANDATORY)

## Goal

Convert tea product documentation from `docs/data/products/<REGION>/<filename>.md` into import-ready JSON files at `import/04-products/<filename>.json`.

**One MD file = one JSON file = one product.**

The JSON file name MUST exactly match the source MD file name (replacing `.md` with `.json`).

## Source → Target Mapping

```
docs/data/products/CHINA-GREEN TEA/+# Си Ху Лун Цзин (西湖龙井, Xīhú Lóngjǐng).md
→
import/04-products/+# Си Ху Лун Цзин (西湖龙井, Xīhú Lóngjǐng).json
```

## JSON Structure

Each JSON file is a **single-element array** `[{ ... }]` (the import API expects arrays).

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
      {
        "lang": "en-US",
        "name": "Xihu Longjing (West Lake Dragon Well)",
        "description": "...",
        "seo": "xihu-longjing",
        "metaDescription": "...",
        "metaTitle": "..."
      },
      {
        "lang": "zh-CN",
        "name": "西湖龙井",
        "description": "...",
        "seo": "xihu-longjing"
      }
    ],

    "catalogs": [
      {
        "catalog": "CATALOG-MAIN",
        "catalogName": "Main Catalog",
        "catalogLang": "en-US",
        "catalogCurrency": "USD",
        "category": "CAT-GREEN-TEA",
        "categoryName": "Green Tea",
        "categoryLang": "en-US",
        "order": 1,
        "published": true
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
        "group": "SPEC-GROUP-CLASSIFICATION", "groupName": "Classification",
        "attribute": "SPEC-TEA-TYPE", "attributeName": "Tea Type",
        "option": "SPEC-TYPE-GREEN", "optionName": "Green Tea",
        "type": "Option", "showOnPage": true, "order": 1
      },
      {
        "lang": "en-US",
        "group": "SPEC-GROUP-BREWING", "groupName": "Brewing",
        "attribute": "SPEC-BREW-TEMP", "attributeName": "Water Temperature",
        "type": "Number", "value": "80",
        "showOnPage": true, "order": 20
      }
    ],

    "origins": [
      {
        "country": "CN",
        "state": "Zhejiang",
        "city": "Hangzhou",
        "altitude": { "min": 100, "max": 800, "unit": "m" },
        "coordinates": { "lat": 30.229, "lng": 120.108 },
        "translations": [
          { "lang": "en-US", "place": "Xihu District, Hangzhou", "notes": "..." },
          { "lang": "ru-RU", "place": "Район Сиху, Ханчжоу", "notes": "..." },
          { "lang": "zh-CN", "place": "杭州市西湖区", "notes": "..." }
        ]
      }
    ],

    "related": [],
    "crossSells": []
  }
]
```

## Field Extraction Rules

### From MD Sections to JSON Fields

| MD Section | JSON Fields |
|---|---|
| **1. Классификация и Происхождение** | `code`, `translations[].name`, `specifications` (tea type, grade), `origins` (country, state, city, coordinates) |
| **2. История и Культурное Значение** | `translations[].description` (include key historical facts) |
| **3. Ботаническое Описание** | `specifications` (cultivar, plucking standard) |
| **4. Терруар и Особенности Выращивания** | `origins` (altitude, coordinates, notes), `specifications` (altitude range, soil type) |
| **5. Технология Производства** | `specifications` (fermentation, roast, kill-green method, oxidation) |
| **6. Органолептические Характеристики** | `specifications` (aroma, body, caffeine, liquor color), `translations[].description` |
| **7. Химический Состав** | `specifications` if notable (caffeine level) |
| **8. Полезные Свойства** | `tags` (health-related tags) |
| **9. Заваривание** | `specifications` (brew temp, steep time, water ratio) |
| **10. Хранение** | `specifications` (shelf life as Duration, storage type) |
| **11. Цена и Подделки** | `tags` (premium/rare/limited) |
| **12. Интересные Факты** | `tags` (UNESCO, GI-protected, awards) |
| **13. Виды чая** | Additional `specifications` if sub-varieties exist |
| **14. Противопоказания** | Skip (not imported) |

### Code Generation

| Field | Pattern | Example |
|---|---|---|
| `code` | `TEA-<COUNTRY>-<NAME>` | `TEA-CN-XIHU-LONGJING` |
| `sku` | `<ABBREV>-<REGION>-<YEAR>-<WEIGHT>` | `XLJ-ZJ-2024-50G` |
| Brand code | `BRAND-<NAME>` | `BRAND-XIHU` |
| Manufacturer code | `MFR-<NAME>` | `MFR-SHIFENG` |
| Tag code | `TAG-<NAME>` | `TAG-TOP10-CHINA` |
| Category code | `CAT-<TYPE>-TEA` | `CAT-GREEN-TEA` |
| Spec group code | `SPEC-GROUP-<NAME>` | `SPEC-GROUP-PROCESSING` |
| Spec attribute code | `SPEC-<NAME>` | `SPEC-FERMENTATION` |
| Spec option code | `SPEC-<ATTR>-<VALUE>` | `SPEC-FERM-0` |

**Codes**: UPPERCASE, hyphens for word separation, Latin only. Country codes: ISO 3166-1 alpha-2 (`CN`, `JP`, `TW`, `IN`).

### Locales

All translations use BCP 47 locale codes:
- `ru-RU` — Russian (MD source language, primary)
- `en-US` — English (translate from Russian)
- `zh-CN` — Simplified Chinese (translate from Russian, especially for tea names)

### Catalog Assignment

Derive the category from MD section 1 (tea type):

| Tea Type (from MD) | Category Code | Category Name |
|---|---|---|
| Зеленый чай | `CAT-GREEN-TEA` | Green Tea |
| Белый чай | `CAT-WHITE-TEA` | White Tea |
| Желтый чай | `CAT-YELLOW-TEA` | Yellow Tea |
| Улун / Оолонг | `CAT-OOLONG-TEA` | Oolong Tea |
| Красный чай / Black tea | `CAT-RED-TEA` | Red (Black) Tea |
| Черный чай (хэй ча) / Dark tea | `CAT-DARK-TEA` | Dark Tea (Hei Cha) |
| Пуэр | `CAT-PUERH-TEA` | Pu-erh Tea |
| Жасминовый / Ароматизированный | `CAT-SCENTED-TEA` | Scented Tea |
| Цветочный / Сухоцветы | `CAT-HERBAL-TEA` | Herbal & Flower Tea |
| Матча | `CAT-MATCHA` | Matcha |

Default catalog: `CATALOG-MAIN` with `catalogCurrency: "USD"`.

### Standard Specification Groups

Use these groups consistently across all products:

| Group Code | Group Name | Typical Attributes |
|---|---|---|
| `SPEC-GROUP-CLASSIFICATION` | Classification | Tea Type, Grade, Sub-type |
| `SPEC-GROUP-PROCESSING` | Processing | Fermentation, Roast, Kill-green, Oxidation, Drying |
| `SPEC-GROUP-BOTANICAL` | Botanical | Cultivar, Plucking Standard, Tree Age |
| `SPEC-GROUP-ORIGIN` | Origin | Altitude, Altitude Range, Harvest Season, Terroir |
| `SPEC-GROUP-ORGANOLEPTIC` | Tasting Notes | Aroma, Body, Caffeine, Liquor Color, Taste Profile |
| `SPEC-GROUP-BREWING` | Brewing | Water Temp, Steep Time, Water Ratio, Gongfu Compatible |
| `SPEC-GROUP-STORAGE` | Storage | Shelf Life, Storage Method |

### Standard Specification Options (reuse across products)

For `type: "Option"`, reuse these codes where applicable:

**Tea Type**: `SPEC-TYPE-GREEN`, `SPEC-TYPE-WHITE`, `SPEC-TYPE-YELLOW`, `SPEC-TYPE-OOLONG`, `SPEC-TYPE-RED`, `SPEC-TYPE-DARK`, `SPEC-TYPE-PUERH-SHENG`, `SPEC-TYPE-PUERH-SHOU`, `SPEC-TYPE-SCENTED`, `SPEC-TYPE-HERBAL`

**Fermentation**: `SPEC-FERM-0`, `SPEC-FERM-5-10`, `SPEC-FERM-10-20`, `SPEC-FERM-15-30`, `SPEC-FERM-30-50`, `SPEC-FERM-60-85`, `SPEC-FERM-85-100`, `SPEC-FERM-POST`

**Roast**: `SPEC-ROAST-NONE`, `SPEC-ROAST-LIGHT`, `SPEC-ROAST-MEDIUM`, `SPEC-ROAST-HEAVY`, `SPEC-ROAST-CHARCOAL`

**Harvest**: `SPEC-HARV-MINGQIAN`, `SPEC-HARV-YUQIAN`, `SPEC-HARV-SPRING`, `SPEC-HARV-SUMMER`, `SPEC-HARV-AUTUMN`, `SPEC-HARV-WINTER`

**Aroma**: `SPEC-AROMA-FLORAL`, `SPEC-AROMA-FRUITY`, `SPEC-AROMA-NUTTY`, `SPEC-AROMA-HONEY`, `SPEC-AROMA-WOODY`, `SPEC-AROMA-SMOKY`, `SPEC-AROMA-EARTHY`, `SPEC-AROMA-GRASSY`, `SPEC-AROMA-MARINE`

**Body**: `SPEC-BODY-LIGHT`, `SPEC-BODY-MEDIUM`, `SPEC-BODY-FULL`

**Caffeine**: `SPEC-CAFF-NONE`, `SPEC-CAFF-LOW`, `SPEC-CAFF-MED`, `SPEC-CAFF-HIGH`

**Altitude**: `SPEC-ALT-LOW` (<500m), `SPEC-ALT-MID` (500-1000m), `SPEC-ALT-HIGH` (>1000m)

For unique/non-standard values, use custom types (`CustomText`, `Number`, `Range`) instead of inventing new options.

### Spec Types Usage

| Type | When to use | Example |
|---|---|---|
| `Option` | Predefined choices from catalog above | Fermentation: `SPEC-FERM-0` |
| `Option` (multiple) | Multiple values for same attribute — add multiple entries | Aroma: nutty + floral = 2 entries |
| `CustomText` | Free-form text | Cultivar: "Longjing #43" |
| `Number` | Single numeric value | Water temp: "80" |
| `Range` | Min/max numeric range | Altitude: `valueMin: 300, valueMax: 800` |
| `Boolean` | Yes/no flag | Gongfu compatible: "true" |
| `Date` | ISO date | Harvest date: "2024-03-28" |
| `Duration` | Seconds (as string) | Shelf life: "63072000" (2 years) |
| `Hyperlink` | URL | Wikipedia link |

### Description Generation

The `description` field should be a **concise summary** (2-4 sentences), NOT the entire MD content. Extract key distinguishing facts:
- What makes this tea special
- Key terroir/origin facts
- Notable flavor characteristics
- Historical significance (if UNESCO/famous)

Include the Chinese name in the description for SEO. Generate descriptions in all 3 languages.

## Workflow

1. Read the source MD file
2. Extract data per section mapping above
3. Generate code, SKU, brand/manufacturer codes from the content
4. Map tea type → category
5. Build specifications from processing/tasting/brewing sections
6. Build origin from terroir section
7. Generate translations in ru-RU (from MD), en-US (translate), zh-CN (translate, especially tea name)
8. Write JSON to `import/04-products/<same-filename>.json`

## Validation Checklist

Before writing the JSON file:

- [ ] File name matches source MD (`.md` → `.json`)
- [ ] JSON is a single-element array `[{ ... }]`
- [ ] `code` is unique, UPPERCASE, Latin-only
- [ ] All 3 locales present in `translations` (ru-RU, en-US, zh-CN)
- [ ] `brand` is nested object with `code` + `translations`
- [ ] `catalogs` has at least one entry with `CATALOG-MAIN`
- [ ] `specifications` covers: tea type, fermentation, roast, harvest, cultivar, aroma, body, caffeine, brew temp
- [ ] `origins` has country (ISO alpha-2), state, coordinates
- [ ] `tags` have both `code` and `name` + `lang`
- [ ] Spec codes are consistent with the standard options table above
- [ ] `lang` values use BCP 47 codes: `ru-RU`, `en-US`, `zh-CN`
- [ ] No empty arrays for required collections (translations, specifications, origins, catalogs)

## Anti-patterns

| Anti-pattern | Fix |
|---|---|
| Copying entire MD content into `description` | Summarize in 2-4 sentences |
| Inventing new Option codes for every product | Reuse standard codes from the table above |
| Using `CustomText` for data that fits standard options | Check the options table first |
| Missing `lang` on specs/tags with `attributeName`/`optionName` | Always include `lang: "en-US"` when using name fields |
| Using flat `"brand": "CODE"` format | Use nested object with translations |
| Forgetting `catalogName`/`catalogLang` in catalogs | Include for auto-create support |
| Generating JSON with multiple products | One file = one product (single-element array) |
