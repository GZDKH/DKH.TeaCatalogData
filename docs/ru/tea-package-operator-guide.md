# Инструкция оператора по пакету подготовки чая

Эта инструкция готовит обычные товары ProductCatalog. Она не добавляет
runtime-тип Tea, отдельный импортёр или зависимость от TeaDB. Файлы в
`templates/product-profiles/tea` — переиспользуемый профиль подготовки данных,
который применяет существующий DataExchange-поток `products`.

## 1. Начните с записи доказательств

Скопируйте `templates/product-profiles/tea/product-template.json` в локальную,
неотслеживаемую рабочую запись. Укажите реальную систему-источник, внешний ID,
URL источника, ревизию и время получения. Дайте товару стабильный код и его
переводы. Не копируйте имя источника, цену, производителя, год сбора, рейтинг,
упаковку, категорию или вариант из другой записи чая.

`examples/yueyang-huangcha.acceptance.json` — эталонный результат. В нём
остаются только подтверждённые карточкой товара факты: жёлтый чай, Китай/
Хунань/Юэян, два отдельных рецепта и месяцы сбора. Неизвестные коммерческие и
производственные факты намеренно не заполняются.

## 2. Разрешите существующие ссылки каталога

Получите актуальные ссылки только для чтения через `DKH.SetupTool`. Утилита
берёт учётные данные из уже настроенного окружения, а не из data-файлов
репозитория:

```bash
dotnet run --project workers/DKH.SetupTool/DKH.SetupTool -- \
  --export-references \
  --snapshot=<reference-snapshot> \
  --workspace-id=<product-catalog-workspace-id> \
  --output-root="$PWD/data/DKH.TeaCatalogData/sources/prod" \
  --client-credentials
```

Используйте коды существующих каталога, категории, спецификации, option,
упаковки и контрагента. Отсутствующий код останавливает валидацию: сначала
создайте или подтвердите обычное generic-определение в ProductCatalog и
обновите выгрузку. Нельзя придумывать ID или позволять импорту создать
определение.

## 3. Заполните типизированные спецификации

Используйте `field-matrix.json` вместе с полным инвентарём 75 определений в
`docs/tea-definition-migration-matrix.json`.

| Данные | Как заполнять |
| --- | --- |
| Таксономия и контролируемые значения | Только существующий код `Option`; неизвестное значение идёт на проверку. |
| Температура | `Number`/`Range` с `°C`; сохраняйте диапазон, если его даёт источник. |
| Масса чая и объём воды | `Number` с `g` и `ml`. |
| Время настаивания | `Duration` в секундах. |
| Максимум проливов | `Number` с `count`. |
| Месяцы сбора и теги | `List` в заданном формате и с проверенными значениями. |
| Повествовательный текст источника | Не маппить по имени раздела; нужно явно названное поле и доказательство источника. |
| Интенсивность сенсорики | Пока не импортировать: она отключена до контракта шкалы и словаря, подтверждённого источником. |

Все значения необязательны, пока существующее generic-определение не говорит
иначе. Значение по умолчанию нельзя вывести из другого чая, категории,
предыдущего источника или дегустационной заметки пользователя. Неизвестные
поля, единицы, options и шкалы идут на проверку, а не сохраняются как Markdown.

## 4. Заполните граф товара без выдуманных коммерческих данных

Используйте обычные поля ProductCatalog, attributes, variants, packages,
releases/origins и DataExchange-профили. Дескриптор подготовки оставляет
категорию, option product attribute, упаковку, sellable combination и offer
неразрешёнными, пока они не подтверждены актуальной выгрузкой.

Для brand, manufacturer, supplier или distributor укажите существующий
CounterpartyService-контрагент по коду и роли. «Vendor» не является текстовым
полем товара и не создаётся по отображаемому имени при импорте.

## 5. Проверьте до любой записи

Из `data/DKH.TeaCatalogData` выполните:

```bash
node scripts/thetea/test-portable-product-profile-contract.js
node scripts/thetea/test-template-coverage.js
node scripts/thetea/test-product-creation-template.js
node scripts/thetea/test-definition-migration-matrix.js
node scripts/thetea/test-spec-contract.js
python3 ../../agents/DKH.AgentRules/scripts/openspec.py cli -- validate portable-tea-data-package --strict
```

Сгенерируйте и проверьте обычный DataExchange-артефакт существующим процессом,
передав обе актуальные выгрузки ссылок:

```bash
node scripts/thetea/generate-import.js \
  --snapshot=<source-snapshot> \
  --out=import/thetea/<artifact-id> \
  --packages=standard \
  --catalog-ref=sources/prod/catalog-reference/<reference-snapshot>.json \
  --product-ref=sources/prod/product-reference/<reference-snapshot>

node scripts/thetea/validate-generated.js \
  --dir=import/thetea/<artifact-id> \
  --report=<artifact-id>-map \
  --catalog-ref=sources/prod/catalog-reference/<reference-snapshot>.json \
  --product-ref=sources/prod/product-reference/<reference-snapshot>
```

Результат обязан сохранить идентичность источника, существующие стабильные коды
определений, тип значения, единицы и несвязанные baseline-записи. До ревью в
нём не должно быть отсутствующих обязательных ссылок.

## 6. Применяйте и проверяйте отдельно

Генерация и валидация не записывают в production. Канарейка одного товара
запускается только утверждённым DataExchange-процессом с явным подтверждением
применения. Прочитайте товар обратно, повторно экспортируйте его, сравните
типы/единицы/options/идентичность источника и только затем запросите отдельное
согласование на массовый импорт.

Секции витрин и личные дегустационные заметки позже используют те же
типизированные данные ProductCatalog. Они не меняют пакет подготовки и не
добавляют в платформу чайные поля.
