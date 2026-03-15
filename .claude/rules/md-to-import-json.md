# MD-to-Import-JSON Conversion (MANDATORY)

## Goal

Convert tea product documentation from `docs/data/products/<REGION>/<filename>.md` into import-ready JSON at `import/04-products/<REGION>/<filename>.json`.

**Folder structure in `import/04-products/` MUST mirror `docs/data/products/`.** Each region subfolder is preserved.

**One MD file = one JSON file = one product.** JSON file name = pinyin tea name in lowercase kebab-case (e.g. `xihu-longjing.json`), derived from the Latin/pinyin name in the MD title parentheses.

## Core Principle: MD Section = Specification Group

**Each numbered MD section becomes a specification group.** The section title IS the group name. Bullet points inside the section become attributes of that group.

```
**5. Технология Производства:**              ← SPEC GROUP (name: "Технология Производства")
* **Сбор (采摘 - cǎi zhāi):** ...            ← Attribute: "Сбор", type: CustomText
* **Подвяливание (摊放):** ...                ← Attribute: "Подвяливание", type: CustomText
* **Температура обжарки:** 80-100°C           ← Attribute: "Температура обжарки", type: Number
```

## Source MD Structure

### File naming

| Regions | Prefix | Example |
|---|---|---|
| CHINA-*, FLOWERS AND DRY | `+# ` | `+# Си Ху Лун Цзин (西湖龙井, Xīhú Lóngjǐng).md` |
| All other regions | `# ` | `# Тенча (碾茶, Tencha).md` |

### Section count: 13–22

Files may have from 13 to 22 sections. Process ALL present sections according to rules below.

**Standard core sections (1–12):**

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
```

**Extended sections (13+, vary by file):**

```
**13. Разновидности <Name>:** / **Виды чая:** / **Сравнение с другими:**
**14. Ошибки при заваривании и хранении:** / **Культура потребления:** / **В заключение:**
**15. Прессовка и выдержка:** / **Культура потребления:** / **Мифы и Легенды:**
**16. Как меняется чай со временем:** / **Сезонность:**
**17. Как выбрать качественную партию:**
**18. Вода и посуда:**
**19. Быстрая памятка по завариванию:**
**20. Дегустация и оценка:**
**21. С чем пить и когда:**
**22. Частые вопросы:**
```

**Japan template (13 sections, different headers):**

```
**1. Определение и основные характеристики:**
**2. История и происхождение:**
**3. Производственный процесс:**
...
```

## Section Processing Rules

### Which sections become SPECIFICATION GROUPS

**ALL sections become specification groups — no exceptions.** Each section title = group name, each bullet = attribute.

Additionally, some sections ALSO produce `translations`, `origins`, or `tags`:

| Section | → specifications (group) | Also → translations | Also → origins | Also → tags |
|---|---|---|---|---|
| 1. Классификация | **Yes** | name | country, state, city, coords | Top10, etc |
| 2. История | **Yes** | description | | UNESCO, Imperial, Heritage |
| 3. Ботаника | **Yes** | | | Ancient Tree |
| 4. Терруар | **Yes** | | altitude, coords, notes | High Mountain |
| 5. Производство | **Yes** | | | Smoked, Aged |
| 6. Органолептика | **Yes** | description | | |
| 7. Хим. состав | **Yes** | | | |
| 8. Полезные свойства | **Yes** | | | health tags |
| 9. Заваривание | **Yes** | | | |
| 10. Хранение | **Yes** | | | |
| 11. Цена и Подделки | **Yes** | | | Premium, Limited, Collectible |
| 12. Интересные Факты | **Yes** | | | GI, Awards, UNESCO |
| 13. Разновидности | **Yes** | | | |
| 14. Ошибки заваривания | **Yes** | | | |
| 15. Прессовка/выдержка | **Yes** | | | Pressed, Aged |
| 16. Изменения со временем | **Yes** | | | |
| 17. Выбор партии | **Yes** | | | |
| 18. Вода и посуда | **Yes** | | | |
| 19. Памятка заваривания | **Yes** | | | |
| 20. Дегустация | **Yes** | | | |
| 21. С чем пить | **Yes** | | | |
| 22. Частые вопросы | **Yes** | | | |

### How to create specs from section content

Each bullet point `* **Bold term:** value text` in a section becomes a specification attribute:

**1. Bold term → attribute name and code:**
```
* **Тип:** Зеленый чай
  → attributeName: "Тип"
  → attribute: "SPEC-TYPE" (transliterate+abbreviate the bold term)
```

**2. Value → determine type and fill accordingly:**

| Value pattern | Spec type | JSON fields |
|---|---|---|
| Matches a predefined Option (see tables below) | `Option` | `option`, `optionName` |
| Single number: `80°C`, `3 грамма` | `Number` | `value: "80"` |
| Range: `80-85°C`, `100-800 метров` | `Range` | `valueMin: 80, valueMax: 85` |
| `да` / `нет` / `true` / `false` | `Boolean` | `value: "true"` |
| Date: `2024-03-28` | `Date` | `value: "2024-03-28"` |
| Duration: `2 года` | `Duration` | `value: "63072000"` (seconds) |
| URL | `Hyperlink` | `value: "https://..."` |
| Everything else (free text) | `CustomText` | `value: "Longjing #43 / Quntizhong"` |

**3. Group code generation from section title:**
```
"5. Технология Производства" → code: "SPEC-GROUP-PROCESSING"
"6. Органолептические Характеристики" → code: "SPEC-GROUP-ORGANOLEPTIC"
```

Use these standardized codes for core sections:

| # | Section title (ru) | Group code | Group name (en-US) |
|---|---|---|---|
| 1 | Классификация и Происхождение | `SPEC-GROUP-CLASSIFICATION` | Classification and Origin |
| 2 | История и Культурное Значение | `SPEC-GROUP-HISTORY` | History and Cultural Significance |
| 3 | Ботаническое Описание и Сырьё | `SPEC-GROUP-BOTANICAL` | Botanical Description |
| 4 | Терруар и Особенности Выращивания | `SPEC-GROUP-TERROIR` | Terroir and Growing |
| 5 | Технология Производства | `SPEC-GROUP-PROCESSING` | Production Technology |
| 6 | Органолептические Характеристики | `SPEC-GROUP-ORGANOLEPTIC` | Organoleptic Characteristics |
| 7 | Химический Состав | `SPEC-GROUP-CHEMISTRY` | Chemical Composition |
| 8 | Полезные Свойства | `SPEC-GROUP-HEALTH` | Health Benefits |
| 9 | Заваривание | `SPEC-GROUP-BREWING` | Brewing |
| 10 | Хранение | `SPEC-GROUP-STORAGE` | Storage |
| 11 | Цена и Подделки | `SPEC-GROUP-PRICE` | Price and Counterfeits |
| 12 | Интересные Факты | `SPEC-GROUP-FACTS` | Interesting Facts |
| 13 | Разновидности / Виды / Сравнение | `SPEC-GROUP-VARIETIES` | Varieties and Comparison |
| 14 | Ошибки при заваривании и хранении | `SPEC-GROUP-MISTAKES` | Common Mistakes |
| 15 | Прессовка и выдержка | `SPEC-GROUP-AGING` | Pressing and Aging |
| 16 | Как меняется чай со временем | `SPEC-GROUP-EVOLUTION` | Aging Evolution |
| 17 | Как выбрать качественную партию | `SPEC-GROUP-SELECTION` | Quality Selection |
| 18 | Вода и посуда | `SPEC-GROUP-EQUIPMENT` | Water and Equipment |
| 19 | Быстрая памятка по завариванию | `SPEC-GROUP-BREW-GUIDE` | Quick Brewing Guide |
| 20 | Дегустация и оценка | `SPEC-GROUP-TASTING` | Tasting and Evaluation |
| 21 | С чем пить и когда | `SPEC-GROUP-PAIRING` | Food Pairing |
| 22 | Частые вопросы | `SPEC-GROUP-FAQ` | FAQ |

For sections with non-standard titles (Japan template, etc.), generate group code from title: `SPEC-GROUP-<TRANSLITERATED-ABBREVIATION>`.

## Predefined Option Values

For common attributes, use standardized Option codes instead of CustomText:

### Tea Type (`SPEC-TEA-TYPE`)

| Option code | Option name | Russian keywords |
|---|---|---|
| `SPEC-TYPE-GREEN` | Green Tea | зеленый, зелёный, неферментированный |
| `SPEC-TYPE-WHITE` | White Tea | белый чай |
| `SPEC-TYPE-YELLOW` | Yellow Tea | жёлтый, желтый |
| `SPEC-TYPE-OOLONG` | Oolong Tea | улун, оолонг |
| `SPEC-TYPE-RED` | Red (Black) Tea | красный чай |
| `SPEC-TYPE-DARK` | Dark Tea (Hei Cha) | тёмный, хэй ча |
| `SPEC-TYPE-PUERH-SHENG` | Sheng Pu-erh | шэн пуэр, 生普 |
| `SPEC-TYPE-PUERH-SHOU` | Shu Pu-erh | шу пуэр, 熟普, постферментированный |
| `SPEC-TYPE-SCENTED` | Scented Tea | жасминовый, ароматизированный |
| `SPEC-TYPE-HERBAL` | Herbal / Flower | цветочный, травяной, не является чаем |
| `SPEC-TYPE-MATCHA` | Matcha | матча, маття |

### Fermentation (`SPEC-FERMENTATION`)

| Option code | Russian keywords |
|---|---|
| `SPEC-FERM-0` | неферментированный, 0% |
| `SPEC-FERM-5-10` | слабоферментированный, 5-10% |
| `SPEC-FERM-10-20` | лёгкая ферментация, 10-20% |
| `SPEC-FERM-15-30` | 15-30% |
| `SPEC-FERM-30-50` | средняя, 30-50% |
| `SPEC-FERM-60-85` | сильная, 60-85% |
| `SPEC-FERM-85-100` | полная, 85-100% |
| `SPEC-FERM-POST` | постферментированный |

### Roast (`SPEC-ROAST`)

| Option code | Russian keywords |
|---|---|
| `SPEC-ROAST-NONE` | без обжарки |
| `SPEC-ROAST-LIGHT` | лёгкая обжарка |
| `SPEC-ROAST-MEDIUM` | средняя обжарка |
| `SPEC-ROAST-HEAVY` | сильная, глубокая |
| `SPEC-ROAST-CHARCOAL` | угольная, на углях |

### Kill-green (`SPEC-KILL-GREEN`)

| Option code | Russian keywords |
|---|---|
| `SPEC-KG-PAN` | обжарка в котлах, 杀青 |
| `SPEC-KG-STEAM` | пропаривание, 蒸 |
| `SPEC-KG-SUN` | солнечная сушка |
| `SPEC-KG-NONE` | нет этапа (белый чай) |

### Harvest (`SPEC-HARVEST`)

| Option code | Russian keywords |
|---|---|
| `SPEC-HARV-MINGQIAN` | до Цинмина, 明前 |
| `SPEC-HARV-YUQIAN` | до Гуюй, 雨前 |
| `SPEC-HARV-SPRING` | весенний, весна |
| `SPEC-HARV-SUMMER` | летний, лето |
| `SPEC-HARV-AUTUMN` | осенний, осень |
| `SPEC-HARV-WINTER` | зимний, зима |

### Aroma (`SPEC-AROMA`) — MULTIPLE entries per product

| Option code | Russian keywords |
|---|---|
| `SPEC-AROMA-FLORAL` | цветочный, орхидея, жасмин, роза, лотос |
| `SPEC-AROMA-FRUITY` | фруктовый, персик, абрикос, слива, цитрус |
| `SPEC-AROMA-NUTTY` | ореховый, каштан, семечки |
| `SPEC-AROMA-HONEY` | медовый, мёд |
| `SPEC-AROMA-WOODY` | древесный, дуб, кедр |
| `SPEC-AROMA-SMOKY` | дымный, копчёный, сосна |
| `SPEC-AROMA-EARTHY` | земляной, грибной, торф |
| `SPEC-AROMA-GRASSY` | травяной, свежая зелень |
| `SPEC-AROMA-MARINE` | морской, водоросли, умами |
| `SPEC-AROMA-CREAMY` | сливочный, маслянистый, молочный |
| `SPEC-AROMA-SPICY` | пряный, специи, корица |
| `SPEC-AROMA-MINERAL` | минеральный, утёсный |
| `SPEC-AROMA-CARAMEL` | карамельный, жжёный сахар |
| `SPEC-AROMA-DRIED-FRUIT` | сухофрукты, чернослив, финик |
| `SPEC-AROMA-CAMPHOR` | камфора, ментол |

### Body (`SPEC-BODY`)

| Option code | Russian keywords |
|---|---|
| `SPEC-BODY-LIGHT` | лёгкий, нежный, деликатный |
| `SPEC-BODY-MEDIUM` | средний, сбалансированный |
| `SPEC-BODY-FULL` | полный, насыщенный, плотный, маслянистый |

### Caffeine (`SPEC-CAFFEINE`)

| Option code | Russian keywords |
|---|---|
| `SPEC-CAFF-NONE` | без кофеина |
| `SPEC-CAFF-LOW` | низкое, слабое |
| `SPEC-CAFF-MED` | умеренное, среднее |
| `SPEC-CAFF-HIGH` | высокое |

### Liquor Color (`SPEC-LIQUOR-COLOR`)

| Option code | Russian keywords |
|---|---|
| `SPEC-COLOR-PALE-GREEN` | бледно-зелёный, светло-зелёный |
| `SPEC-COLOR-GREEN` | зелёный |
| `SPEC-COLOR-YELLOW-GREEN` | жёлто-зелёный |
| `SPEC-COLOR-YELLOW` | жёлтый, соломенный |
| `SPEC-COLOR-GOLD` | золотистый |
| `SPEC-COLOR-AMBER` | янтарный |
| `SPEC-COLOR-ORANGE` | оранжевый, медный |
| `SPEC-COLOR-RED` | красный, рубиновый |
| `SPEC-COLOR-DARK-RED` | тёмно-красный, бордовый |
| `SPEC-COLOR-BROWN` | коричневый, тёмный |

### Altitude (`SPEC-ALTITUDE`)

| Option code | Range |
|---|---|
| `SPEC-ALT-LOW` | <500m |
| `SPEC-ALT-MID` | 500–1000m |
| `SPEC-ALT-HIGH` | >1000m |

### Pressing (`SPEC-PRESSING`)

| Option code | Russian keywords |
|---|---|
| `SPEC-PRESS-CAKE` | блин, бин, 饼 |
| `SPEC-PRESS-BRICK` | кирпич, 砖 |
| `SPEC-PRESS-TUAN` | точа, туо, 沱 |
| `SPEC-PRESS-LOOSE` | рассыпной |

### Leaf Type (`SPEC-LEAF-TYPE`)

| Option code | Russian keywords |
|---|---|
| `SPEC-LEAF-SMALL` | мелколистовой |
| `SPEC-LEAF-MEDIUM` | среднелистовой |
| `SPEC-LEAF-LARGE` | крупнолистовой, дайе, 大叶 |

## Fields NOT in MD (do NOT populate)

MD files are product documentation, NOT commercial data. The following JSON fields have **no source in MD** and must be left empty or omitted:

| JSON field | Why absent |
|---|---|
| `price`, `oldPrice`, `catalogPrice`, `productCost` | No real prices — section 11 has general market ranges, not our prices |
| `callForPrice`, `enteredPrice`, `minEnteredPrice`, `maxEnteredPrice` | Commercial settings, not in docs |
| `tierPrices[]` | Wholesale pricing tiers — not in docs |
| `catalogPrices[]` | Per-catalog price overrides — not in docs |
| `media[]` | MD has `![image](images/...)` references but these are doc images, not product media assets in storage |
| `related[]` | Cross-product relationships are not defined in individual MD files |
| `crossSells[]` | Same — not in MD |
| `availableStartDate`, `availableEndDate` | Availability dates — commercial, not in docs |
| `availableForPreOrder`, `preOrderDate` | Pre-order settings — not in docs |
| `markAsNew`, `markAsNewStartDate`, `markAsNewEndDate` | Marketing flags — not in docs |

These fields can be populated later via separate import files or manual entry.

## Non-Specification Fields

### `translations[].description` — summary from sections 1, 2, 6

2-4 sentence summary. Include Chinese name, what's special, flavor profile, historical note if notable.

### `origins[]` — from sections 1, 4

- `country`: ISO alpha-2 from section 1
- `state`: province from section 1
- `city`: city if mentioned
- `altitude`: from section 4 (min/max/unit)
- `coordinates`: from section 1 or 4
- `translations[].place`: from section 4 sub-regions
- `translations[].notes`: soil, climate, terroir notes from section 4

### `packages[]` — standard set per region (NOT from MD)

MD has no packaging data. Include a standard set of packages based on the region:

| Region | Packages (default marked `*`) | Notes |
|---|---|---|
| CHINA-* | 50g, 100g, 250g, **500g (一斤)\*** | Pricing standard is per 斤 (500g) |
| JAPAN | 30g, 50g, 100g, **500g\*** | Small packages common, 500g default |
| INDIA | 50g, 100g, 250g, **500g\*** | Standard tea packaging |
| SRI LANKA(CEYLON) | 50g, 100g, 250g, **500g\*** | Standard tea packaging |
| NEPAL | 50g, 100g, 250g, **500g\*** | Standard tea packaging |
| KOREA | 30g, 50g, 100g, **500g\*** | Premium, small packages common |
| FLOWERS AND DRY | 30g, 50g, 100g, **500g\*** | Lightweight products |
| *all other regions* | 50g, 100g, 250g, **500g\*** | General default |

Package codes: `PKG-30G`, `PKG-50G`, `PKG-100G`, `PKG-250G`, `PKG-500G`. Unit always `"g"`.

### `tags[]` — from sections 1, 2, 3, 4, 5, 8, 10, 11, 12, 15

| Source | Tag codes |
|---|---|
| `Десяти знаменитых` | `TAG-TOP10-CHINA` |
| `императорский` | `TAG-IMPERIAL` |
| `UNESCO` | `TAG-UNESCO` |
| `древние деревья / 古树` | `TAG-ANCIENT-TREE` |
| `высокогорный / >1000m` | `TAG-HIGH-MOUNTAIN` |
| `копчение` | `TAG-SMOKED` |
| Health keywords (sec 8) | `TAG-ANTIOXIDANT`, `TAG-DIGESTION`, `TAG-ENERGY`, `TAG-RELAXING`, `TAG-WARMING` |
| `дорогой / элитный` | `TAG-PREMIUM` |
| `редкий` | `TAG-LIMITED-EDITION` |
| `коллекционный` | `TAG-COLLECTIBLE` |
| `GI / защищённое` | `TAG-GI-PROTECTED` |
| Pressed (sec 15) | `TAG-PRESSED` |
| Aging (sec 10/15/16) | `TAG-AGED-TEA` |
| `органический` | `TAG-ORGANIC` |
| Always | `TAG-SINGLE-ORIGIN` |
| Region folder → | `TAG-CHINA`, `TAG-JAPAN`, `TAG-INDIA`, `TAG-TAIWAN`, etc. |

### `catalogs[]` — nested catalog + category with translations and parent

Both `catalog` and `category` support nested format with multi-translations. Plain string code is also accepted for backward compat.

**Category** derived from tea type in section 1:

| Tea type keyword | Category code | Category name (en-US) | Категория (ru-RU) | 分类 (zh-CN) |
|---|---|---|---|---|
| зеленый | `CAT-GREEN-TEA` | Green Tea | Зелёный чай | 绿茶 |
| белый | `CAT-WHITE-TEA` | White Tea | Белый чай | 白茶 |
| жёлтый | `CAT-YELLOW-TEA` | Yellow Tea | Жёлтый чай | 黄茶 |
| улун | `CAT-OOLONG-TEA` | Oolong Tea | Улун | 乌龙茶 |
| красный | `CAT-RED-TEA` | Red (Black) Tea | Красный чай | 红茶 |
| тёмный / хэй ча | `CAT-DARK-TEA` | Dark Tea | Тёмный чай | 黑茶 |
| пуэр | `CAT-PUERH-TEA` | Pu-erh Tea | Пуэр | 普洱茶 |
| жасминовый | `CAT-SCENTED-TEA` | Scented Tea | Ароматизированный чай | 花茶 |
| цветочный / травяной | `CAT-HERBAL-TEA` | Herbal & Flower Tea | Цветочный и травяной | 花草茶 |
| матча | `CAT-MATCHA` | Matcha | Матча | 抹茶 |

Categories can have parent: `"parent": "CAT-TEA"` to build hierarchy.

**Catalog** derived from REGION folder:

| Region folder | Catalog code | Catalog name (en-US) | Currency |
|---|---|---|---|
| CHINA-* | `CATALOG-CHINESE-TEA` | Chinese Tea | `CNY` |
| JAPAN | `CATALOG-JAPANESE-TEA` | Japanese Tea | `JPY` |
| INDIA | `CATALOG-INDIAN-TEA` | Indian Tea | `INR` |
| SRI LANKA(CEYLON) | `CATALOG-CEYLON-TEA` | Ceylon Tea | `LKR` |
| KOREA | `CATALOG-KOREAN-TEA` | Korean Tea | `KRW` |
| NEPAL | `CATALOG-NEPALESE-TEA` | Nepalese Tea | `NPR` |
| VIETNAM | `CATALOG-VIETNAMESE-TEA` | Vietnamese Tea | `VND` |
| INDONESIA | `CATALOG-INDONESIAN-TEA` | Indonesian Tea | `IDR` |
| KENYA | `CATALOG-KENYAN-TEA` | Kenyan Tea | `KES` |
| GEORGIA | `CATALOG-GEORGIAN-TEA` | Georgian Tea | `GEL` |
| FLOWERS AND DRY | `CATALOG-HERBAL-FLOWER` | Herbal & Flower | `USD` |
| *all other regions* | `CATALOG-<COUNTRY>-TEA` | \<Country\> Tea | `USD` |

**JSON format:**

```json
"catalogs": [
  {
    "catalog": {
      "code": "CATALOG-CHINESE-TEA",
      "currency": "CNY",
      "translations": [
        { "lang": "en-US", "name": "Chinese Tea" },
        { "lang": "ru-RU", "name": "Китайский чай" },
        { "lang": "zh-CN", "name": "中国茶" }
      ]
    },
    "category": {
      "code": "CAT-GREEN-TEA",
      "parent": "CAT-TEA",
      "translations": [
        { "lang": "en-US", "name": "Green Tea" },
        { "lang": "ru-RU", "name": "Зелёный чай" },
        { "lang": "zh-CN", "name": "绿茶" }
      ]
    },
    "order": 1,
    "published": true
  }
]
```

If catalog/category already exists by code — just used, not recreated. Translations only used during auto-create.

## Code Generation

| Field | Pattern |
|---|---|
| `code` | `TEA-<CC>-<NAME>` (CC = ISO country, NAME = abbreviated Latin) |
| `sku` | `<NAME>-<REGION-ABBR>` (name + region abbreviation, no weight/year — MD has no packaging data) |
| Brand | `BRAND-<NAME>` |
| Manufacturer | `MFR-<NAME>` |
| Group | `SPEC-GROUP-<NAME>` (from standard table or transliterated) |
| Attribute | `SPEC-<ABBREVIATED-NAME>` |
| Option | `SPEC-<ATTR>-<VALUE>` |

All codes: UPPERCASE, Latin-only, hyphens.

## Markdown Formatting in Text Fields

All `CustomText` values, `translations[].description`, and `origins[].translations[].notes` MUST use **Markdown** formatting:

- **bold** (`**text**`) — key terms, proper names, cultivar names, zone names, important numbers
- *italic* (`*text*`) — Chinese/Latin terms, dynasty names, botanical names, aroma/flavor descriptors
- Combine: `**Shi Feng** *(Lion Peak)*` for names with translations

Do NOT format: Option values, Range values, codes, short factual values (vitamins, minerals lists).

## Locales

- `ru-RU` — from MD source (primary)
- `en-US` — translate
- `zh-CN` — translate; tea name from title parentheses `(西湖龙井)`

## Validation Checklist

- [ ] Output path = `import/04-products/<REGION>/<pinyin-name>.json` (same region folder as source MD)
- [ ] File name = pinyin tea name in lowercase kebab-case (e.g. `xihu-longjing.json`)
- [ ] JSON is `[{ ... }]` (single-element array)
- [ ] `code` unique, UPPERCASE, Latin
- [ ] 3 locales in `translations`
- [ ] `brand` nested with translations
- [ ] `catalogs[]` with auto-create fields
- [ ] Specs: EVERY MD section (1–22, all present) → spec group, no sections skipped
- [ ] Aroma: MULTIPLE entries if multiple aromas detected
- [ ] Predefined options used where applicable (not CustomText)
- [ ] `origins[]` with country, coordinates, altitude
- [ ] `tags[]` with `code` + `name` + `lang`
- [ ] All `attributeName`/`optionName` include `lang: "en-US"`
