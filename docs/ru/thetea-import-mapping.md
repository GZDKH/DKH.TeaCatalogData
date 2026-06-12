# Маппинг импорта TheTea в DKH ProductCatalog

Статус: документ согласования перед импортом для `GZDKH/DKH.TeaCatalogData#14`.

Этот документ фиксирует, какие данные TheTea API сохраняются как первоисточник и как сгенерированный import JSON попадает в структуру DKH ProductCatalog DataExchange. Продовый импорт нельзя применять, пока этот маппинг, validation report и prod category mapping report не согласованы.

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
| `GET /api/v2/tea/{slug}.md?lang=<lang>` | `raw/markdown/<lang>/<slug>.md` | Полная локализованная Markdown-страница сохраняется как source/audit content. В product specifications не импортируется. |
| `GET /api/v2/tea/{slug}/similar?lang=<lang>&limit=12` | `raw/similar/<lang>/<slug>.json` | Локализованный similar-tea payload сохраняется как source/audit content. Curated related-product links - отдельный follow-up. |

Runtime/query методы `/search`, `/semantic`, `/ask`, `/compare`, `/random` не являются детерминированным источником всех продуктов: они зависят от запроса или случайности. Их контракт сохраняется в `raw/source/openapi.yaml`, но в первый импорт как canonical product input они не используются.

## Куда генерируется импорт

Генератор пишет один JSON array на один продукт:

```text
import/thetea/<snapshot-id>/04-products/<THE_TEA_CATEGORY>/<slug>.json
```

Внутри файла - один объект ProductCatalog DataExchange product.

Генератор также пишет определения категорий из того же snapshot:

```text
import/thetea/<snapshot-id>/03-categories/categories.json
```

Если передан `--catalog-ref=...`, файл `03-categories/categories.json` содержит только категории, которых нет в production category reference, плюс отсутствующих родителей. Без `--catalog-ref` это полный generated TheTea taxonomy для локального ревью; напрямую применять такой файл в production нельзя, потому что category import может обновить уже существующие категории.

## Маппинг продукта

| ProductCatalog field | TheTea source | Правило |
|---|---|---|
| `code` | TeaCard `meta.origin_country`, `slug` | `TEA-<COUNTRY>-<SLUG>`, нормализуется под ProductCatalog code. Пример: `TEA-CN-XIHU-LONGJING`. |
| `sku` | TeaCard `slug`, `meta.origin_country` | `<SLUG>-<COUNTRY>`, нормализуется. |
| `published` | Import option | По умолчанию `false`. `--publish` только после отдельного согласования. |
| `nativeName` | TeaCard `names.zh` / `names.zh-CN` | Китайское нативное имя, если есть. |
| `transcription` | TeaCard `name` | Текст из последнего parenthesized transcription segment. |
| `translations[]` | Локализованные TeaCards | По одной translation на каждую локаль из snapshot manifest. Description собирается из enrichment, recipes и выбранных section details. |
| `catalogs[]` | TeaCard `meta.tea_type`, `meta.province`, `meta.shape`, `meta.processing`, `meta.roast_level`, `meta.family_id`, TeaCard `tags` | Всегда `CATALOG-CHINESE-TEA`; устойчивые taxonomy-поля TheTea мапятся в категории типа, региона, формы листа, обработки, прожарки, семейства и особенностей. |
| `packages[]` | Import option | По умолчанию `PKG-50G`; `--packages=standard` добавляет 25g, 100g, 250g, 500g. |
| `tags[]` | TeaCard `tags`, `enrichment.flavor_tags` | Детерминированные коды `TAG-TT-*` и `TAG-FLAVOR-*`. |
| `specifications[]` | TeaCard `meta`, `sections`, `recipe`, `harvest`, `sensory`, `enrichment`, field endpoints | См. раздел "Маппинг спецификаций". |
| `origins[]` | TeaCard `meta`, локализованные origin/terroir sections | Country, state/province, city/county, altitude, coordinates и локализованные notes. |

## Маппинг локалей

Продовый snapshot использует все локали из TheTea `/api/v2/meta.locales` и снимает field detail endpoints для всех этих локалей через `--field-langs=all`.

| TheTea locale | ProductCatalog locale |
|---|---|
| `en` | `en-US` |
| `ru` | `ru-RU` |
| `zh`, `zh-CN` | `zh-CN` |
| Остальные BCP 47 значения | Сохраняются как есть, например `zh-HK`, `zh-TW`, `nb`, `de`, `fr`. |

Если diagnostic snapshot не содержит локализованную карточку, генератор может создать name-only fallback для `en-US`, `ru-RU`, `zh-CN`. Для полного продового запуска это неприемлемо: production должен идти через `--langs=all`.

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

Перед импортом `fetch-prod-reference.js` должен сохранить текущие prod catalog/categories. `generate-import.js` или `validate-generated.js` должны запускаться с `--catalog-ref=...`. В отчете должно быть:

```text
Catalog found: yes
Missing categories: 0
```

## Маппинг спецификаций

Группы спецификаций используют `SPEC-TT-GROUP-<SECTION>`.

| Source | ProductCatalog spec type | Code namespace |
|---|---|---|
| Controlled values: tea type, shape, roast level, caffeine level, seasons, occasions, flavor tags | `Option` | `SPEC-TT-*` или `SPEC-TT-FIELD-*` плюс option code |
| Min/max пары: oxidation, brew temperature, altitude | `Range` | `SPEC-TT-<SECTION>-<FIELD>` |
| Numeric field endpoint values (`value_num`) | `Number` | `SPEC-TT-FIELD-<SECTION>-<FIELD>` |
| Полный field endpoint prose (`value_md`) из primary card locale | `CustomMarkdownText` | `SPEC-TT-FIELD-DETAIL-<SECTION>-<FIELD>` |
| Rich TeaCard section prose | `CustomMarkdownText` | `SPEC-TT-FIELD-<SECTION>-<FIELD>` |
| List-like values | `List` | `SPEC-TT-*` |
| Dates | `Date` | `SPEC-TT-SOURCE-LAST-UPDATED` |

Неизвестные numbered fields вроде `*_xN` не выбрасываются: они сохраняются с детерминированными именами.

## Что не импортируется в первом запуске

В первый импорт намеренно не пишем:

- Prices, tier prices, catalog prices.
- Stock или inventory quantities.
- Media uploads и ProductCatalog media attachment IDs.
- Cross-sells как product relations.
- Runtime AI answers из `/ask`, произвольные search/semantic queries и random samples.

Контракт этих методов остается в `raw/source/openapi.yaml`.

## Gates перед импортом

Первый production import можно делать только если:

1. Raw source snapshot создан и имеет `Errors: 0`. Warnings типа `missing-field-detail` допустимы только когда TheTea возвращает `404` на field endpoint; они должны быть сохранены в `raw/field-missing/`. Production snapshot не должен иметь partial field locales.
2. В snapshot есть `Source contract files: 4`.
3. Generated report показывает `Valid: yes`.
4. Если новых TheTea категорий нет в prod, `03-categories/categories.json` генерируется через `--catalog-ref=...`, dry-run валидируется через `--profile=categories`, применяется только после согласования, затем prod references загружаются заново.
5. Финальный prod mapping report показывает `Catalog found: yes` и `Missing categories: 0`.
6. Token AdminGateway проходит `CatalogImport` policy (`super-admin`, `full-access`, `catalog-manager` или `catalog:import`).
7. Generated import прошел dry-run validate через локальный AdminGateway over VPN.
8. Пользователь явно согласовал `--apply --yes`.

## Команды первого импорта

```bash
node scripts/thetea/fetch-snapshot.js --snapshot=thetea-2026-06-02 --langs=all --field-langs=all --concurrency=4 --resume
node scripts/thetea/fetch-prod-reference.js --snapshot=prod-2026-06-02
node scripts/thetea/generate-import.js --snapshot=thetea-2026-06-02 --out=import/thetea/thetea-2026-06-02 --packages=standard --catalog-ref=sources/prod/catalog-reference/prod-2026-06-02.json
node scripts/thetea/import-generated.js --snapshot=thetea-2026-06-02 --profile=categories
node scripts/thetea/fetch-prod-reference.js --snapshot=prod-2026-06-02-after-categories
node scripts/thetea/validate-generated.js --dir=import/thetea/thetea-2026-06-02 --report=thetea-2026-06-02-prod-map --catalog-ref=sources/prod/catalog-reference/prod-2026-06-02-after-categories.json
node scripts/thetea/import-generated.js --snapshot=thetea-2026-06-02
```

Apply command, только после согласования:

```bash
node scripts/thetea/import-generated.js --snapshot=thetea-2026-06-02 --apply --yes
```
