# GEMINI.md

## Project Overview

DKH.TeaCatalogData is a data repository for tea product documentation and import files for ProductCatalogService.

## Structure

- `docs/regions/` - MD files with tea product documentation (592 files, 35 regions)
- `docs/categories/` - Category description files
- `import/` - JSON files for import via ProductCatalogService DataExchange API
- `scripts/` - PowerShell scripts for conversion and import

## Locales

All translations use BCP 47 locale codes (aligned with ReferenceService):
- **ru-RU** — Russian (primary content language)
- **en-US** — English
- **zh-CN** — Simplified Chinese

## MD File Format

Each MD file contains 14 numbered sections in Russian:
1. Классификация и Происхождение (Classification)
2. История и Культурное Значение (History)
3. Ботаническое Описание (Botanical)
4. Терруар и Особенности Выращивания (Terroir)
5. Технология Производства (Processing)
6. Органолептические Характеристики (Organoleptic)
7. Химический Состав (Chemical)
8. Полезные Свойства (Health Benefits)
9. Заваривание (Brewing)
10. Хранение (Storage)
11. Цена и Подделки (Price)
12. Интересные Факты (Facts)
13. Виды чая (Types)
14. Возможные противопоказания (Contraindications)

## JSON Import Format

Products JSON uses ProductCatalogService schema. Note: JSON uses short field name `"lang"`, but values are BCP 47 locale codes.

```json
{
  "code": "TEA-PRODUCT-CODE",
  "sku": "SKU-CODE",
  "translations": [
    { "lang": "ru-RU", "name": "Название", "description": "Описание", "seo": "nazvanie" },
    { "lang": "en-US", "name": "Name", "description": "Description", "seo": "name" },
    { "lang": "zh-CN", "name": "名称", "description": "描述", "seo": "mingcheng" }
  ],
  "specifications": [...],
  "tags": [{ "code": "TAG-CODE" }],
  "origins": [...]
}
```

## Import Order

1. `01-reference/` - catalogs, tags, brands, packages
2. `02-specifications/` - groups → attributes → options
3. `03-categories/` - categories hierarchy
4. `04-products/` - products by region

## Related Files

- `D:\projects\GZDKH\services\DKH.ProductCatalogService\docs\data-exchange\examples\` - JSON templates
- `D:\projects\GZDKH\services\DKH.ProductCatalogService\` - ProductCatalogService source

## Commands

```powershell
# Convert MD to JSON
./scripts/Convert-MdToJson.ps1 -SourcePath ./docs/regions/japan -OutputPath ./import/04-products

# Validate import data
./scripts/Validate-Import.ps1 -Path ./import/01-reference

# Import to ProductCatalogService
./scripts/Import-Data.ps1 -Profile "products" -File ./import/04-products/products-china-green.json
```
