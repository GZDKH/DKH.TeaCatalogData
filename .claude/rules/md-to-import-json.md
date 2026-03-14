# MD-to-Import-JSON Conversion (MANDATORY)

## Goal

Convert tea product documentation from `docs/data/products/<REGION>/<filename>.md` into import-ready JSON at `import/04-products/<filename>.json`.

**One MD file = one JSON file = one product.** JSON file name MUST match source MD name (`.md` → `.json`).

## Source MD Structure

### File naming patterns

| Regions | Prefix | Example |
|---|---|---|
| CHINA-*, FLOWERS AND DRY | `+# ` | `+# Си Ху Лун Цзин (西湖龙井, Xīhú Lóngjǐng).md` |
| All other regions | `# ` | `# Тенча (碾茶, Tencha).md` |

Version suffix `v2` may appear: `+# Лю Бао Хэй Ча (六堡茶, Liù Bǎo Chá)v2.md`

### Standard 14-section template (China, India, Flowers, most regions)

```
**1. Классификация и Происхождение:**
**2. История и Культурное Значение:**
**3. Ботаническое Описание и Сырьё:**
**4. Терруар и Особенности Выращивания:**
**5. Технология Производства:**
**6. Органолептические Характеристики:**
**7. Химический Состав:**
**8. Полезные Свойства:**
**9. Заваривание:**
**10. Хранение:**
**11. Цена и Подделки:**
**12. Интересные Факты:**
**13. Разновидности <Name>:** / **Сравнение с другими <Category>:** / **Виды чая:**
**14. В заключение:** / **Возможные противопоказания:**
```

### Japan template (13 sections, different structure)

```
**1. Определение и основные характеристики:**
**2. История и происхождение:**
**3. Производственный процесс:**
**4. Разновидности и Градации:**
**5. Внешний вид:**
**6. Аромат и вкусовой профиль:**
**7. Использование:**
**8. Хранение:**
**9. Культурное значение:**
**10. Современные тенденции и инновации:**
**11. Сенсорный Опыт:**
**12. Гастрономические сочетания:**
**13. Простота как основа:**
```

Some China-Green files have 13 sections (no section 14).

### MD content format

- Bold headers: `**Section Title:**`
- Bullet points: `* **Bold term:** Description`
- Chinese with pinyin: `(西湖龙井, Xīhú Lóngjǐng)`
- Temperatures: `80-85°C`
- Weights: `3-5 грамм на 150-200 мл`
- Images: `![name](images/file.png)` — skip, not imported

## Section → JSON Field Mapping

### Section 1: Классификация и Происхождение

Extract:

| MD content | JSON field | How |
|---|---|---|
| `**Тип:** Зеленый чай` | `specifications[]: type Option` | Map to standard tea type option |
| `**Категория:**` text | `specifications[]: grade Option` | If mentions "Десяти знаменитых чаев", top-10 etc |
| `**Происхождение:** Китай, провинция X, город Y` | `origins[].country`, `.state`, `.city` | Country → ISO alpha-2 (`CN`, `JP`, `TW`, `IN`, `LK`) |
| `**Географические координаты:** 30° с.ш., 120° в.д.` | `origins[].coordinates.lat`, `.lng` | Parse degrees |
| Tea type keyword | `catalogs[].category` | Map from type word → category code (see table below) |
| Also derives | `code`, `translations[].name` | From file title and section 1 name |

**Tea type → category mapping:**

| Russian keyword in section 1 | Category Code |
|---|---|
| Зеленый чай / зелёный | `CAT-GREEN-TEA` |
| Белый чай | `CAT-WHITE-TEA` |
| Жёлтый чай / желтый | `CAT-YELLOW-TEA` |
| Улун / Оолонг / полуферментированный | `CAT-OOLONG-TEA` |
| Красный чай / Red tea | `CAT-RED-TEA` |
| Чёрный чай (хэй ча) / Тёмный / Dark | `CAT-DARK-TEA` |
| Пуэр / Шэн / Шу | `CAT-PUERH-TEA` |
| Жасминовый / ароматизированный / Scented | `CAT-SCENTED-TEA` |
| Цветочный / травяной / Herbal / сухоцветы | `CAT-HERBAL-TEA` |
| Матча / Маття | `CAT-MATCHA` |

Also use the REGION folder name as hint: `CHINA-GREEN TEA` → `CAT-GREEN-TEA`.

### Section 3: Ботаническое Описание и Сырьё

Extract:

| MD content | JSON field |
|---|---|
| `**Сорта:** Лун Цзин №43 / Цюнь Ти Чжун` | `specifications[]: SPEC-CULTIVAR, type: CustomText, value: "Longjing #43 / Quntizhong"` |
| `**Стандарт сбора:** одна почка и один-два листочка` | `specifications[]: SPEC-PLUCKING-STANDARD, type: CustomText` |

### Section 4: Терруар и Особенности Выращивания

Extract:

| MD content | JSON field |
|---|---|
| `**Высота произрастания:** 100-800 метров` | `origins[].altitude: { min: 100, max: 800, unit: "m" }` |
| `**Высота:**` same data | `specifications[]: SPEC-ALTITUDE-RANGE, type: Range, valueMin/valueMax` |
| `**Почвы:** Красные и желтые почвы` | `origins[].translations[].notes` (include in notes) |
| `**Климат:** Мягкий субтропический` | `origins[].translations[].notes` (include in notes) |
| Specific sub-regions (Ши Фэн, etc.) | `origins[].translations[].place` |

### Section 5: Технология Производства

Extract:

| MD content | JSON field |
|---|---|
| `неферментированный` / degree info | `specifications[]: SPEC-FERMENTATION, type: Option` |
| Kill-green method mentioned | `specifications[]: SPEC-KILL-GREEN, type: Option` |
| Roast info | `specifications[]: SPEC-ROAST, type: Option` |
| Oxidation level if mentioned | `specifications[]: SPEC-OXIDATION, type: CustomText` |
| Drying method | `specifications[]: SPEC-DRYING, type: CustomText` |
| Harvest season (`до Цинмина`, `весенний сбор`) | `specifications[]: SPEC-HARVEST, type: Option` |

**Fermentation mapping from text:**

| Russian text | Option code |
|---|---|
| неферментированный / 0% | `SPEC-FERM-0` |
| слабоферментированный / 5-10% | `SPEC-FERM-5-10` |
| 10-20% | `SPEC-FERM-10-20` |
| лёгкая ферментация / 15-30% | `SPEC-FERM-15-30` |
| средняя / 30-50% | `SPEC-FERM-30-50` |
| сильная / 60-85% | `SPEC-FERM-60-85` |
| полная / 85-100% | `SPEC-FERM-85-100` |
| постферментированный / пуэр | `SPEC-FERM-POST` |

**Harvest mapping:**

| Russian text | Option code |
|---|---|
| до Цинмина / 明前 / Mingqian | `SPEC-HARV-MINGQIAN` |
| до Гуюй / 雨前 / Yuqian | `SPEC-HARV-YUQIAN` |
| весенний сбор / весна | `SPEC-HARV-SPRING` |
| летний сбор / лето | `SPEC-HARV-SUMMER` |
| осенний сбор / осень | `SPEC-HARV-AUTUMN` |
| зимний сбор / зима | `SPEC-HARV-WINTER` |

### Section 6: Органолептические Характеристики

Extract:

| MD content | JSON field |
|---|---|
| `**Аромат:**` keywords | `specifications[]: SPEC-AROMA, type: Option` — may be MULTIPLE entries |
| `**Вкус:**` body description | `specifications[]: SPEC-BODY, type: Option` |
| `**Цвет настоя:**` | `specifications[]: SPEC-LIQUOR-COLOR, type: Option` |

**Aroma keyword → option mapping (multiple allowed):**

| Russian keyword | Option code |
|---|---|
| цветочный / орхидея / жасмин | `SPEC-AROMA-FLORAL` |
| фруктовый / персик / абрикос | `SPEC-AROMA-FRUITY` |
| ореховый / каштан / семечки | `SPEC-AROMA-NUTTY` |
| медовый / мёд | `SPEC-AROMA-HONEY` |
| древесный / дуб | `SPEC-AROMA-WOODY` |
| дымный / копчёный / сосна | `SPEC-AROMA-SMOKY` |
| земляной / землистый / торф | `SPEC-AROMA-EARTHY` |
| травяной / свежая зелень | `SPEC-AROMA-GRASSY` |
| морской / водоросли / умами | `SPEC-AROMA-MARINE` |
| сливочный / маслянистый / молочный | `SPEC-AROMA-CREAMY` |
| пряный / специи / корица | `SPEC-AROMA-SPICY` |
| минеральный / утёсный | `SPEC-AROMA-MINERAL` |

**Body mapping:**

| Russian text | Option code |
|---|---|
| лёгкий / нежный / деликатный | `SPEC-BODY-LIGHT` |
| средний / сбалансированный | `SPEC-BODY-MEDIUM` |
| полный / насыщенный / плотный / мощный | `SPEC-BODY-FULL` |

**Liquor color options:**

`SPEC-COLOR-PALE-GREEN`, `SPEC-COLOR-GREEN`, `SPEC-COLOR-YELLOW-GREEN`, `SPEC-COLOR-YELLOW`, `SPEC-COLOR-GOLD`, `SPEC-COLOR-AMBER`, `SPEC-COLOR-ORANGE`, `SPEC-COLOR-RED`, `SPEC-COLOR-DARK-RED`, `SPEC-COLOR-BROWN`

### Section 7: Химический Состав

Extract:

| MD content | JSON field |
|---|---|
| `**Кофеином:** умеренное` | `specifications[]: SPEC-CAFFEINE, type: Option` |

**Caffeine mapping:**

| Russian text | Option code |
|---|---|
| без кофеина / нет | `SPEC-CAFF-NONE` |
| низкое / слабое | `SPEC-CAFF-LOW` |
| умеренное / среднее | `SPEC-CAFF-MED` |
| высокое / много | `SPEC-CAFF-HIGH` |

### Section 8: Полезные Свойства

Extract → `tags[]` (health-related):

| MD keyword | Tag code |
|---|---|
| антиоксидант | `TAG-ANTIOXIDANT` |
| пищеварение / желудок | `TAG-DIGESTION` |
| тонизирующий / бодрит | `TAG-ENERGY` |
| успокаивающий / расслабление | `TAG-RELAXING` |
| снижение веса / метаболизм | `TAG-WEIGHT-LOSS` |
| иммунитет | `TAG-IMMUNITY` |
| сердечно-сосудистая | `TAG-HEART-HEALTH` |

### Section 9: Заваривание

Extract:

| MD content | JSON field |
|---|---|
| `**Температура воды:** 80-85°C` | `specifications[]: SPEC-BREW-TEMP, type: Number, value: "80"` (use lower bound) |
| `**Количество чая:** 3-5 грамм на 150-200 мл` | `specifications[]: SPEC-BREW-RATIO, type: CustomText, value: "3-5g / 150-200ml"` |
| `настаивайте 1-2 минуты` | `specifications[]: SPEC-STEEP-TIME, type: Range, valueMin: 60, valueMax: 120` (seconds) |
| `3-5 раз` / `повторяйте` | `specifications[]: SPEC-INFUSIONS, type: Number, value: "5"` (upper bound) |
| `гайвань / чайник` | `specifications[]: SPEC-GONGFU, type: Boolean, value: "true"` (if гайвань mentioned) |

### Section 10: Хранение

Extract:

| MD content | JSON field |
|---|---|
| Shelf life info | `specifications[]: SPEC-SHELF-LIFE, type: Duration, value: "<seconds>"` |
| `в холодильнике` / storage method | `specifications[]: SPEC-STORAGE, type: CustomText, value: "Refrigerated, airtight"` |

### Section 11: Цена и Подделки

Extract → `tags[]`:

| MD keyword | Tag code |
|---|---|
| дорогих / элитных / premium | `TAG-PREMIUM` |
| редкий / limited | `TAG-LIMITED-EDITION` |
| коллекционный / инвестиционный | `TAG-COLLECTIBLE` |

### Section 12: Интересные Факты

Extract → `tags[]`:

| MD keyword | Tag code |
|---|---|
| UNESCO / нематериальное наследие | `TAG-UNESCO` |
| GI / географическое указание / защищённое | `TAG-GI-PROTECTED` |
| Десяти знаменитых / Top 10 | `TAG-TOP10-CHINA` |
| императорский / imperial | `TAG-IMPERIAL` |
| древние деревья / ancient tree / 古树 | `TAG-ANCIENT-TREE` |

### Sections 13-14: Разновидности / Заключение

Skip — not imported. Only use for additional tags if sub-varieties or specific awards are mentioned.

### Japan template mapping

| Japan section | Maps to same fields as |
|---|---|
| 1. Определение и характеристики | Sections 1 + 3 (classification + botany) |
| 2. История и происхождение | Section 2 (history) |
| 3. Производственный процесс | Section 5 (processing) |
| 4. Разновидности и Градации | Section 13 (varieties) — skip |
| 5. Внешний вид | Section 6 partial (appearance) |
| 6. Аромат и вкусовой профиль | Section 6 (organoleptic) |
| 7. Использование | Section 9 (brewing/usage) |
| 8. Хранение | Section 10 (storage) |
| 9-13 | Cultural context — extract tags, skip rest |

## JSON Output Structure

```json
[
  {
    "code": "TEA-CN-XIHU-LONGJING",
    "sku": "XLJ-ZJ-2024-50G",
    "order": 1,
    "published": true,

    "brand": {
      "code": "BRAND-<DERIVED>",
      "translations": [
        { "lang": "en-US", "name": "..." },
        { "lang": "ru-RU", "name": "..." }
      ]
    },

    "manufacturer": {
      "code": "MFR-<DERIVED>",
      "translations": [
        { "lang": "en-US", "name": "..." },
        { "lang": "ru-RU", "name": "..." }
      ]
    },

    "translations": [
      {
        "lang": "ru-RU",
        "name": "<from title + section 1>",
        "description": "<2-4 sentence summary from sections 1,2,6>",
        "seo": "<transliterated-slug>",
        "metaDescription": "<SEO meta, 150 chars>",
        "metaTitle": "<SEO title, 60 chars>"
      },
      {
        "lang": "en-US",
        "name": "<translated>",
        "description": "<translated summary>",
        "seo": "<english-slug>",
        "metaDescription": "<translated>",
        "metaTitle": "<translated>"
      },
      {
        "lang": "zh-CN",
        "name": "<Chinese name from parentheses in title>",
        "description": "<translated summary>",
        "seo": "<pinyin-slug>"
      }
    ],

    "catalogs": [
      {
        "catalog": "CATALOG-MAIN",
        "catalogName": "Main Catalog",
        "catalogLang": "en-US",
        "catalogCurrency": "USD",
        "category": "<from tea type>",
        "categoryName": "<English name>",
        "categoryLang": "en-US",
        "order": 1,
        "published": true
      }
    ],

    "packages": [
      { "package": "PKG-50G", "packageName": "50g", "packageUnit": "g", "quantity": 1, "default": true }
    ],

    "tags": [
      { "code": "TAG-...", "name": "...", "lang": "en-US" }
    ],

    "specifications": [
      {
        "lang": "en-US",
        "group": "SPEC-GROUP-...", "groupName": "...",
        "attribute": "SPEC-...", "attributeName": "...",
        "option": "SPEC-...", "optionName": "...",
        "type": "Option",
        "showOnPage": true,
        "order": 1
      }
    ],

    "origins": [
      {
        "country": "<ISO alpha-2>",
        "state": "<province/region>",
        "city": "<city if available>",
        "altitude": { "min": 100, "max": 800, "unit": "m" },
        "coordinates": { "lat": 30.0, "lng": 120.0 },
        "translations": [
          { "lang": "en-US", "place": "...", "notes": "..." },
          { "lang": "ru-RU", "place": "...", "notes": "..." },
          { "lang": "zh-CN", "place": "...", "notes": "..." }
        ]
      }
    ],

    "related": [],
    "crossSells": []
  }
]
```

## Code Generation Rules

| Field | Pattern | Source |
|---|---|---|
| `code` | `TEA-<CC>-<NAME>` | CC = country ISO alpha-2, NAME = transliterated abbreviated |
| `sku` | `<ABBR>-<REGION>-<YEAR>-<WEIGHT>` | Abbreviation from name, region code, current year, default weight |
| Brand `code` | `BRAND-<NAME>` | Derive from region/factory if mentioned in MD |
| Manufacturer `code` | `MFR-<NAME>` | Derive from producer/factory if mentioned in MD |
| Tag `code` | `TAG-<NAME>` | UPPERCASE, hyphens |
| Spec group `code` | `SPEC-GROUP-<NAME>` | From standard table |
| Spec attribute `code` | `SPEC-<NAME>` | From standard table or generated |
| Spec option `code` | `SPEC-<ATTR>-<VALUE>` | From standard table |

All codes: UPPERCASE, Latin-only, hyphens for word separation.

## Standard Specification Groups

| Code | Name (en-US) | order range |
|---|---|---|
| `SPEC-GROUP-CLASSIFICATION` | Classification | 1-10 |
| `SPEC-GROUP-PROCESSING` | Processing | 11-20 |
| `SPEC-GROUP-BOTANICAL` | Botanical | 21-30 |
| `SPEC-GROUP-ORIGIN` | Origin | 31-40 |
| `SPEC-GROUP-ORGANOLEPTIC` | Tasting Notes | 41-60 |
| `SPEC-GROUP-BREWING` | Brewing | 61-70 |
| `SPEC-GROUP-STORAGE` | Storage | 71-80 |

## Standard Tags (always include `name` + `lang: "en-US"`)

Derive from sections 1, 8, 11, 12. Add `TAG-SINGLE-ORIGIN` to all single-origin teas. Use region folder name to derive region tag: `TAG-CHINA`, `TAG-JAPAN`, `TAG-INDIA`, `TAG-TAIWAN` etc.

## Locales

- `ru-RU` — from MD source (primary)
- `en-US` — translate from Russian
- `zh-CN` — translate; for tea name use Chinese characters from title parentheses `(西湖龙井)`

## Description Rules

`description` is a **2-4 sentence summary**, NOT the entire MD. Include:
- Chinese name with characters
- What makes this tea special (from section 1)
- Key flavor notes (from section 6)
- Historical/cultural note if famous (from section 2)

## Validation Checklist

- [ ] JSON file name = MD file name with `.json` extension
- [ ] JSON is `[{ ... }]` (single-element array)
- [ ] `code` unique, UPPERCASE, Latin
- [ ] 3 locales in `translations` (ru-RU, en-US, zh-CN)
- [ ] `brand` is nested object with translations
- [ ] `catalogs[]` has CATALOG-MAIN with auto-create fields
- [ ] `specifications[]` covers minimum: tea type, fermentation, aroma, body, caffeine, brew temp
- [ ] `origins[]` has country (ISO), coordinates, altitude
- [ ] `tags[]` have `code` + `name` + `lang`
- [ ] All spec names use `lang: "en-US"` when `attributeName`/`optionName` present
- [ ] Aroma specs: multiple entries if multiple aromas in MD
- [ ] `lang` values are BCP 47: `ru-RU`, `en-US`, `zh-CN`
