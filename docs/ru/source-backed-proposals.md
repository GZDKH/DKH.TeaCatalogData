# Source-backed fill-missing предложения

`prepare-source-proposal.js` готовит проверяемый артефакт из одной неизменяемой карточки источника и полного экспорта ProductCatalog. Используется существующий формат DataExchange `products`; отдельный tea-runtime, seed, endpoint или внешняя интеграция не добавляются.

```bash
node scripts/thetea/prepare-source-proposal.js \
  --source-card=/path/to/raw/cards/en/yueyang-huangcha.json \
  --source-manifest=/path/to/manifest.json \
  --field-pack=/path/to/raw/d1/field-packs/yueyang-huangcha.json.gz \
  --product-ref=/path/to/product-reference/prod-products-<snapshot> \
  --article-url=https://tea.community/ru-RU/products/yueyang-huangcha
```

Команда только читает входные данные и записывает `proposal.json`, `proposals.json`, `desired-products.json` и `rollback-products.json` в `reports/thetea/source-proposals/<slug>/`. Если передан D1 field pack, его строки нужной локали накладываются тем же нормализатором полей, который использует обычный генератор, а его хеш участвует в проверке устаревшего входа. Для каждого значения сохраняются точный код товара, ссылка на статью, snapshot, версия и дата обновления карточки, хеши источника и baseline, JSON Pointer и исходный фрагмент.

Правила заполнения отсутствующих данных:

- отсутствующая спецификация, метка, локализация или часть origin предлагается к добавлению;
- существующее значение сохраняется, включая `0` и `false`;
- отличающееся значение попадает в `reviewQueue` и автоматически не заменяется;
- две записи рецепта, harvest или sensory с одним ключом и разными данными становятся конфликтом для проверки;
- полный диапазон не заменяет baseline с пропущенной границей: создаётся причина `range-truncation`;
- сопоставление товара выполняется только по точному коду ProductCatalog, полученному из страны и slug; нечеткий поиск имён запрещён.

`desired-products.json` содержит полный вложенный payload для существующего replace-mode exchange. `rollback-products.json` содержит исходный baseline для каждого изменения. При отсутствии изменений или при необходимости проверки payload остаётся пустым. Перед последующим применением хеши источника и baseline должны совпадать; изменившийся вход считается устаревшим и требует новой подготовки.

Для карточки Yueyang текущий baseline даёт 30 неизменённых наблюдений и не создаёт предложений на запись. Это ожидаемо: механизм подтверждает полноту данных, не перезаписывая текущий товар.
