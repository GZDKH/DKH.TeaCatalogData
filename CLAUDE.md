# CLAUDE.md

## Project Overview

DKH.TeaCatalogData is a data repository for tea product documentation and import files for ProductCatalogService.

## Structure

- `docs/regions/` - MD files with tea product documentation (592 files, 35 regions)
- `docs/categories/` - Category description files
- `import/` - JSON files for import via ProductCatalogService DataExchange API
- `scripts/` - PowerShell scripts for conversion and import

## Languages

All translations use three languages: **RU**, **EN**, **ZH**

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

Products JSON uses ProductCatalogService schema:
```json
{
  "code": "TEA-PRODUCT-CODE",
  "sku": "SKU-CODE",
  "translations": [
    { "lang": "en", "name": "...", "description": "...", "seoName": "..." },
    { "lang": "ru", "name": "...", "description": "...", "seoName": "..." },
    { "lang": "zh", "name": "...", "description": "...", "seoName": "..." }
  ],
  "specs": [...],
  "tags": [...],
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
