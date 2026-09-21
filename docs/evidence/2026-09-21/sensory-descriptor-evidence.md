# Sensory descriptor source evidence

- Status: `review-required`
- Publish normalized sensory axes: `no`
- TheTea snapshot: `thetea-content-d1-2026-07-27`
- Product: [yueyang-huangcha](https://tea.community/ru-RU/products/yueyang-huangcha)

This evidence resolves candidate labels for the 15 opaque source IDs without changing ProductCatalog definitions or product values. The dictionary is a cross-domain reference and still requires owner approval before labels or intensity are published as normalized tea descriptors.

## Descriptor evidence

| ID | Candidate label | Russian label | Group | Yueyang value | Status |
| --- | --- | --- | --- | ---: | --- |
| `Be` | Butter | Масло | ANIMAL | absent | review-required |
| `Ch` | Cherry | Вишня | FRUIT | absent | review-required |
| `Cz` | Caramelized | Карамелизированный | SWEET | 3 | review-required |
| `Dt` | Date | Финик | FRUIT | absent | review-required |
| `H` | Honey | Мёд | SWEET | 3 | review-required |
| `L` | Lemon | Лимон | FRUIT | 3 | review-required |
| `Li` | Lichee | Личи | FRUIT | 2 | review-required |
| `Lm` | Lime | Лайм | FRUIT | absent | review-required |
| `Mn` | Magnolia | Магнолия | FLORAL | absent | review-required |
| `Mw` | Marshmallow | Маршмеллоу | SWEET | 1 | review-required |
| `O` | Orange | Апельсин | FRUIT | absent | review-required |
| `Pc` | Peach | Персик | FRUIT | absent | review-required |
| `Rb` | Raspberry | Малина | BERRY | absent | review-required |
| `Sb` | Strawberry | Клубника | BERRY | absent | review-required |
| `Se` | Sweet Aromatics | Сладкая ароматика | SWEET | absent | review-required |

## Scale decision

- The snapshot contains observed intensity values 1–5.
- The payload does not declare the meaning, anchors, or whether 0 is a valid score.
- Missing descriptors mean absence from the source array; they are not zero.
- The normalized numeric axis remains unpublished until the source owner or catalog owner approves the scale and anchors.

## Evidence sources

- TheTea card snapshot: `sources/thetea/snapshots/thetea-content-d1-2026-07-27/raw/cards/en/yueyang-huangcha.json`
- Card SHA-256: `725b5260cf9f2a518b6a4bf7dcb29659ca8e9edd215010d28bdb6cfb00c27ca9`
- Snapshot manifest SHA-256: `fb9bf10d2ed6a5ca1c89ceed87613255656970ddb9dd9d554a7636bed55238e9`
- Dictionary: [Sensory Codes 2019 PDF](https://www.coffeeproject.ru/images/blog/224/Sensory-Codes-2019.pdf)
- Dictionary publisher page: [https://cooffee.ru/industriya/tablicy-sensornyh-kodov-ot-aleksandra-cybaeva/](https://cooffee.ru/industriya/tablicy-sensornyh-kodov-ot-aleksandra-cybaeva/)

This report is preparation evidence only. It does not create a tea-specific runtime profile, definitions, or import adapter.
