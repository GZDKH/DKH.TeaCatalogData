# Импорт данных из публичных каталогов

Каноническая английская версия:
[`docs/catalog-source-ingestion.md`](../catalog-source-ingestion.md).

Модуль импорта публичных каталогов является границей ETL, а не runtime
торгового провайдера. Он находится в `DKH.TeaCatalogData` и создаёт
версионируемый source-agnostic artifact для последующей проверяемой проекции в
ProductCatalog.

Общий runtime отвечает за страницы, ограниченную конкурентность, retry,
ограничения ответа, checkpoints, digests исходных и нормализованных данных,
replay и drift-gates. Connector отвечает только за фиксированные публичные
endpoints, decoder ответа и правила нормализации. В будущем администраторы смогут
настраивать развёрнутые экземпляры connector и расписания, но не смогут
загружать или выполнять JavaScript парсеров.

ZZCTea является источником справочных рыночных котировок. Его значения никогда
не перезаписывают розничные или каталожные цены DKH. Нормализованный artifact
разделяет исходные наблюдения и рассчитанные значения для единиц упаковки и
сохраняет точное происхождение вычислений. Artifact сохраняет только прошедшее
проверку безопасное plain-text описание из detail payload как source evidence.
Офлайн-проекция создаёт фактические описания DKH для `zh-CN` и `en-US` из
структурированных полей и точных компонентов упаковки, не копирует исходный
текст и не добавляет boilerplate `zzctea.com`.

Runtime не получает списки продавцов/покупателей и контактные или профильные
данные. Исходные зашифрованные ответы list/detail сохраняются только после
проверки расшифрованного payload по PII-policy. Частичный или drifted запуск
сохраняет последний успешный artifact и не может создавать tombstones или
изменять production.

Проверяемая офлайн-проекция создаёт provider-neutral DTO наблюдений
CommerceNetwork, детерминированный отчёт и manifest с хешами. Она не выполняет
сетевых запросов и production-записей. Для reconciliation с ProductCatalog и
публикации в CommerceNetwork нужны полные authoritative references, read-back,
canary одного продукта и отдельный проверяемый этап apply.

Офлайн-reconciliation ProductCatalog использует только точный неизменяемый код
`ZZC-<externalId>` и полный nested export продуктов. Результат содержит полные
baseline-preserving product patches, rollback aggregates, детерминированные
source mappings и Draft-only отчёт для отсутствующих продуктов. Fuzzy matching
и изменение retail/catalog prices запрещены. Текущий catalog reference
структурно проверяется и хешируется, но пока не имеет собственного completeness
manifest, поэтому reconciliation явно остаётся non-authoritative и не готов к
публикации.

Команды, структура output и operator gates описаны в
[`scripts/catalog-sources/README.md`](../../scripts/catalog-sources/README.md).
