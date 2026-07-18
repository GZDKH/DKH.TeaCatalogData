# Маппинг импорта TheTea в DKH ProductCatalog

Статус: контракт синхронизации типизированной детализации для `GZDKH/DKH.TeaCatalogData#15`.

Этот документ фиксирует, какие данные TheTea API сохраняются как первоисточник и как сгенерированный import JSON попадает в структуру DKH ProductCatalog DataExchange. Продовый импорт нельзя применять, пока не согласованы этот маппинг, validation report, точные hashes prod catalog и полного product baseline, а также результат canary.

## Первоисточник

Первоисточник данных - raw API snapshot:

```text
sources/thetea/snapshots/<snapshot-id>/raw/
```

Файлы в `import/thetea/<snapshot-id>/` - производные артефакты. Их можно пересобрать из raw snapshot. Для каждого продового импорта raw snapshot нужно сохранять как immutable audit artifact.

## Источники TheTea API

| TheTea API source | Snapshot path | Использование в ProductCatalog |
|---|---|---|
| `GET /docs` | `raw/source/docs.html` | Аудит документации API. |
| `GET /openapi.yaml` | `raw/source/openapi.yaml` | Аудит API-контракта. |
| `GET /llms.txt` | `raw/source/llms.txt` | Аудит списка методов API. |
| `GET https://tea.support/skill/SKILL.md` | `raw/source/skill.md` | Аудит внешнего TheTea skill/source summary. |
| `GET /api/v2/meta` | `raw/meta.json` | Локали, страны, metadata API. Используется для `--langs=all`. |
| `GET /api/v2/family` | `raw/family.json` | Справочный источник для дальнейшей доработки family/category enrichment. |
| `GET /api/v2/glossary?lang=<lang>` | `raw/glossary-<lang>.json` | Локализованный справочник для дальнейшей ручной курации. |
| `GET /api/v2/map?lang=<lang>` | `raw/map-<lang>.json` | Гео/source audit. Origins в продукте строятся из TeaCard metadata/sections. |
| `GET /api/v2/teas?lang=<lang>&limit=<n>&offset=<n>` | `raw/teas-<lang>.json` | Пагинированный список slug. Fetcher идет по страницам до последней неполной страницы, чтобы будущий рост API не отрезал данные. |
| `GET /api/v2/tea/{slug}?lang=<lang>` | `raw/cards/<lang>/<slug>.json` | Главная TeaCard: product core, translations, catalog/category mapping, tags, origins, recipes, sensory, base specifications. |
| `GET /api/v2/tea/{slug}/{lang}/field/{code}` | `raw/fields/<lang>/<slug>/<section>/<field>.json` | Детализация каждого поля для каждой locale в production snapshot. `value_md`, `value_num`, `unit` накладываются на TeaCard перед генерацией. |
| `GET /api/v2/tea/{slug}/{lang}/field/{code}` с ответом `404` | `raw/field-missing/<lang>/<slug>/<section>/<field>.json` | Audit trail для поля, которое есть в TeaCard, но не доступно через detail endpoint TheTea. Это warning, не fatal fetch error. |
| `GET /api/v2/tea/{slug}.md?lang=<lang>` | `raw/markdown/<lang>/<slug>.md` | Полная локализованная Markdown-страница сохраняется как source/audit content и маршрутизируется в article sidecar. В product specifications не разворачивается. |
| `GET /api/v2/tea/{slug}/similar?lang=<lang>&limit=12` | `raw/similar/<lang>/<slug>.json` | Source/audit payload и fallback для `related[]`. Сначала используются curated `enrichment.similar_teas`, затем endpoint; self-links и дубликаты отбрасываются, generated relations ограничены 12. |

Runtime/query методы `/search`, `/semantic`, `/ask`, `/compare`, `/random` не являются детерминированным источником всех продуктов: они зависят от запроса или случайности. Их контракт сохраняется в `raw/source/openapi.yaml`, но в первый импорт как canonical product input они не используются.

## Куда генерируется импорт

Генератор пишет один JSON array на один продукт; имя файла строится из детерминированного product code:

```text
import/thetea/<snapshot-id>/04-products/<THE_TEA_CATEGORY>/<PRODUCT-CODE>.json
```

Внутри файла - один объект ProductCatalog DataExchange product.

Полная структура артефакта:

```text
01-reference/                 catalog reference record
02-specifications/            определения groups, attributes и options
03-categories/                отсутствующие определения категорий
04-products/                  по одному продукту в файле
05-catalog-bindings/          привязки catalog/category/product
06-routed-content/articles/   локализованный Markdown и long narratives
06-routed-content/metaobjects локализованные FAQ
artifact-manifest.json        точный inventory, hashes, locales и loss events
```

Output сначала собирается в соседней временной директории и заменяет текущий каталог атомарно только после semantic и manifest validation. При успехе stale files удаляются; при ошибке предыдущий валидный output остается нетронутым.

С `--catalog-ref=...` файл `03-categories/categories.json` содержит только категории, которых нет в этом exact production reference, плюс отсутствующих родителей. Без catalog reference и полного `--product-ref=...` разрешена только diagnostic generation с явными `--allow-missing-*`. У diagnostic artifact пустые reference hashes, поэтому apply запрещён.

## Маппинг продукта

| ProductCatalog field | TheTea source | Правило |
|---|---|---|
| `code` | TeaCard `meta.origin_country`, `slug` | `TEA-<COUNTRY>-<SLUG>`, нормализуется под ProductCatalog code. Пример: `TEA-CN-XIHU-LONGJING`. |
| `sku` | TeaCard `slug`, `meta.origin_country` | `<SLUG>-<COUNTRY>`, нормализуется. |
| `published` | Import option | По умолчанию `false`. `--publish` только после отдельного согласования. |
| `nativeName` | TeaCard `names.zh` / `names.zh-CN` | Китайское нативное имя, если есть. |
| `transcription` | TeaCard `name` | Текст из последнего parenthesized transcription segment. |
| `translations[]` | Локализованные TeaCards | По одной translation на каждую локаль из snapshot manifest. Короткий description содержит enrichment и recipe summary; полный Markdown и narratives маршрутизируются отдельно. |
| `catalogs[]` | TeaCard `meta.tea_type`, `meta.province`, `meta.shape`, `meta.processing`, `meta.roast_level`, `meta.family_id`, TeaCard `tags` | Всегда `CATALOG-CHINESE-TEA`; устойчивые taxonomy-поля TheTea мапятся в категории типа, региона, формы листа, обработки, прожарки, семейства и особенностей. |
| `packages[]` | Import option | По умолчанию `PKG-50G`; `--packages=standard` добавляет 25g, 100g, 250g, 500g. |
| `tags[]` | TeaCard `tags`, `enrichment.flavor_tags` | Детерминированные коды `TAG-TT-*` и `TAG-FLAVOR-*`. |
| `specifications[]` | TeaCard `meta`, `sections`, `recipe`, `harvest`, `sensory`, `enrichment`, field endpoints | См. раздел "Маппинг спецификаций". |
| `origins[]` | TeaCard `meta`, локализованные origin/terroir sections | Country, state/province, city/county, altitude, coordinates и локализованные notes. |
| `related[]` | `enrichment.similar_teas`, локализованный `/similar`, production baseline | Slug преобразуется в deterministic product code в two-pass transform; self/duplicates отбрасываются, generated links ограничены 12, существующие ручные связи сохраняются. |
| `crossSells[]` | Полный production product baseline | TheTea не выводит cross-sells; существующие значения сохраняются без изменений. |

## Маппинг локалей

Продовый snapshot использует все локали из TheTea `/api/v2/meta.locales` и снимает field detail endpoints для всех этих локалей через `--field-langs=all`.

| TheTea locale | ProductCatalog locale |
|---|---|
| `en` | `en-US` |
| `ru` | `ru-RU` |
| `zh`, `zh-CN` | `zh-CN` |
| Остальные BCP 47 значения | Сохраняются как есть, например `zh-HK`, `zh-TW`, `nb`, `de`, `fr`. |

Если diagnostic snapshot не содержит локализованную карточку, генератор может создать name-only fallback для `en-US`, `ru-RU`, `zh-CN`. Для полного продового запуска это неприемлемо: production должен идти через `--langs=all`.

Definitions групп, атрибутов и опций получают translation row для каждой required locale. Для известных структурных labels есть curated названия `en-US`, `ru-RU`, `zh-CN`. Для остальных локалей используется явно отражённый в отчёте и manifest English fallback; он не выдаётся за перевод из источника.

## Каталог и категории

Все продукты идут в:

```text
CATALOG-CHINESE-TEA
```

Маппинг типов:

| TheTea `meta.tea_type` | DKH category |
|---|---|
| `green` | `CAT-GREEN-TEA` |
| `white` | `CAT-WHITE-TEA` |
| `yellow` | `CAT-YELLOW-TEA` |
| `oolong` | `CAT-OOLONG-TEA` |
| `red` | `CAT-RED-TEA` |
| `dark` | `CAT-DARK-TEA` |
| `puer` | `CAT-PUER-TEA` |

Провинция дает вторую региональную категорию, например `Zhejiang -> CAT-REGION-ZHEJIANG`. Сейчас известны: Anhui, Chongqing, Fujian, Guangdong, Guangxi, Guizhou, Hainan, Henan, Hubei, Hunan, Jiangsu, Jiangxi, Jilin, Shaanxi, Shandong, Sichuan, Taiwan, Tibet, Xinjiang, Yunnan, Zhejiang. Неизвестные провинции получают fallback `CAT-REGION-CHINA` с warning и должны быть проверены до production import.

Дополнительные generated category dimensions:

| TheTea source | DKH category namespace | Комментарий |
|---|---|---|
| `meta.shape` | `CAT-SHAPE-*` под `CAT-BY-SHAPE` | Needle, flat, strip, spiral, brick, pearl, cake. |
| `meta.processing` | `CAT-PROC-*` под `CAT-BY-PROCESSING` | `chaoqing`, `hongqing`, `zhengqing`. |
| `meta.roast_level` | `CAT-ROAST-*` под `CAT-BY-ROAST` | `none`, `light`, `medium`, `heavy`. |
| TeaCard `tags` | `CAT-SPEC-*` под `CAT-BY-SPECIALTY` | В категории идут только устойчивые недублирующие теги: GI, UNESCO ICH, Ten Famous Teas, Three Needles, Needle Shape. Type/region теги игнорируются, потому что дублируют более надежные поля. |
| `/api/v2/family` | `CAT-FAMILY-*` под `CAT-BY-FAMILY` | Family categories генерируются как справочник. К продуктам они назначаются только если TeaCard содержит `meta.family_id`. В текущем snapshot от 2026-06-02 все `family_id` пустые, поэтому family categories пока не назначаются товарам. |

Поля `enrichment.flavor_tags`, `enrichment.occasion`, `enrichment.best_season`, `enrichment.caffeine_level`, `enrichment.difficulty`, `enrichment.price_tier` остаются тегами/спецификациями, а не ветками дерева категорий. Это фильтры и контекстные атрибуты, не стабильные разделы каталога.

Перед импортом `fetch-prod-reference.js` должен сохранить текущие prod catalog/categories, а полный nested JSON export DataExchange profile `products` — production product baseline. Generation и все последующие validate/import команды используют одни и те же exact `--catalog-ref=...` и `--product-ref=...`; их SHA-256 записываются в `artifact-manifest.json`.

В отчете должно быть:

```text
Catalog found: yes
Missing categories: 0
```

## Маппинг спецификаций

У каждой managed specification ровно одна группа и один атрибут. У продукта может быть не более одной value row для каждого managed attribute. Группы используют `SPEC-TT-GROUP-<SECTION>`, все managed definitions — namespace `SPEC-TT-*`.

| Source | ProductCatalog spec type | Code namespace |
|---|---|---|
| Controlled singleton: tea type, shape, processing, roast level, caffeine level, difficulty, price tier | `Option` | Атрибут плюс один стабильный option code |
| Repeated scalars: seasons, occasions, flavor tags, food pairings, harvest months | `List` | Один атрибут, `value` — JSON-строка массива |
| Min/max: oxidation и brew temperature | `Range` | Всегда обе границы; одностороннее значение становится point range с одинаковыми границами |
| Известные numeric значения и sensory descriptor scores | `Number` | Числовая строка в `value`, unit при наличии контракта |
| Recipe time | `Duration` | Секунды в `value`, unit `s` |
| Флаги, например geographical-indication status | `Boolean` | Каноническая строка `true`/`false` |
| Stable short/rich text | `CustomText` / `CustomMarkdownText` | Одна canonical semantic; дополнительный prose отделён или routed |
| Dates | `Date` | `SPEC-TT-SOURCE-LAST-UPDATED` |

Repeated objects разворачиваются по стабильному discriminator, а не пишутся как `List<object>`: recipe по `style`, harvest по `phase`, sensory по descriptor. Конфликт type, unit, parent, option или translation metadata — fatal.

Origin country/place, coordinates и altitude живут только в `origins[]`; altitude не дублируется specification. Исправление дробных тысяч применяется только при подтверждающем контексте и всегда отражается в warnings.

Весь локализованный section prose сохраняется в article sidecar, поэтому значения non-canonical локалей не схлопываются. Короткое stable canonical значение может дополнительно остаться typed text specification. Synthetic `*_xN` и `ext_*`, полный Markdown, FAQ и длинные narratives никогда не становятся техническими product attributes и существуют только в `06-routed-content/`. Текущий ProductCatalog importer эти sidecars не импортирует; для них нужен отдельный article/metaobject шаг canary workflow.

Transformer не создаёт параллельные raw и derived attributes одной семантики. Canonical typed value хранится один раз; дополнительный prose — отдельная detail semantic либо routed content.

## Baseline overlay при replace-mode

Product DataExchange заменяет dependent collections. Повторный upsert безопасен только после overlay generated TheTea data на полный текущий production product export.

Для существующего продукта ETL заменяет managed `SPEC-TT-*` и generated TheTea origins, но сохраняет unrelated specifications, translations неизвестных локалей, manual tags, catalog assignments, packages, prices, store overrides, cross-sells, существующие related links и остальные baseline fields. Generated related объединяются с существующими. Baseline-preservation validation падает, если unrelated entry исчезает или меняется.

Для нового продукта TheTea не выдумывает live prices, inventory, media IDs или cross-sells. Без полного product baseline hash apply запрещён.

## Что не выводится из TheTea

Для новых товаров из TheTea не выводятся:

- Live prices, tier prices, catalog prices и store overrides.
- Stock или inventory quantities.
- Media uploads и ProductCatalog media attachment IDs.
- Cross-sells.
- Runtime AI answers из `/ask`, произвольные search/semantic queries и random samples.

Значения существующих продуктов, доступные в baseline DataExchange, сохраняются. Контракт runtime-методов остается в `raw/source/openapi.yaml`.

## Gates перед импортом

Первый production import можно делать только если:

1. Raw source snapshot создан и имеет `Errors: 0`. Warnings типа `missing-field-detail` допустимы только когда TheTea возвращает `404` на field endpoint; они должны быть сохранены в `raw/field-missing/`. Production snapshot не должен иметь partial field locales.
2. В snapshot есть `Source contract files: 4`.
3. Есть текущий catalog/category reference и полный DataExchange JSON baseline профиля `products`.
4. Generated report и `artifact-manifest.json` показывают `Valid: yes`, exact file parity и непустые source/catalog/baseline hashes.
5. После применения категорий нужно получить новый catalog reference и полностью пересобрать artifact; новый reference с прежним artifact будет отклонён по hash.
6. Финальный mapping показывает `Catalog found: yes` и `Missing categories: 0`.
7. Definitions импортируются до products через SetupTool или другой approved ordered DataExchange workflow. `import-generated.js` поддерживает только `categories` и `products`; definitions, bindings, articles и FAQ sidecars он не загружает.
8. Token проходит нужные `CatalogExport`/`CatalogImport` policies и workspace access.
9. One-product canary проходит dry-run, применяется только после отдельного canary approval и сравнивается после read-back.
10. Пользователь отдельно согласовал массовый `--apply --yes`.

## Команды первого импорта

```bash
node scripts/thetea/fetch-snapshot.js --snapshot=thetea-2026-06-02 --langs=all --field-langs=all --concurrency=4 --resume
node scripts/thetea/fetch-prod-reference.js --snapshot=prod-2026-06-02
node scripts/thetea/fetch-prod-products.js --snapshot=prod-products-2026-06-02
node scripts/thetea/generate-import.js --snapshot=thetea-2026-06-02 --out=import/thetea/thetea-2026-06-02 --packages=standard --catalog-ref=sources/prod/catalog-reference/prod-2026-06-02.json --product-ref=sources/prod/product-reference/prod-products-2026-06-02
node scripts/thetea/validate-generated.js --dir=import/thetea/thetea-2026-06-02 --report=thetea-2026-06-02-prod-map --catalog-ref=sources/prod/catalog-reference/prod-2026-06-02.json --product-ref=sources/prod/product-reference/prod-products-2026-06-02
node scripts/thetea/import-generated.js --snapshot=thetea-2026-06-02 --catalog-ref=sources/prod/catalog-reference/prod-2026-06-02.json --product-ref=sources/prod/product-reference/prod-products-2026-06-02 --only=TEA-CN-XIHU-LONGJING --limit=1
```

Canary apply, только после отдельного явного согласования:

```bash
node scripts/thetea/import-generated.js --snapshot=thetea-2026-06-02 --catalog-ref=sources/prod/catalog-reference/prod-2026-06-02.json --product-ref=sources/prod/product-reference/prod-products-2026-06-02 --only=TEA-CN-XIHU-LONGJING --limit=1 --apply --yes
```

Массовый product apply — отдельная команда и отдельное согласование после canary read-back. Routed article/FAQ content через `import-generated.js` не применяется.
