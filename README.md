# DKH.TeaCatalogData

Repository for tea product documentation (MD) and import data (JSON) for ProductCatalogService.

## Structure

```
DKH.TeaCatalogData/
├── docs/                              # MD documentation
│   ├── regions/                       # Tea products by region (592 files)
│   │   ├── china/
│   │   │   ├── green-tea/
│   │   │   ├── white-tea/
│   │   │   ├── oolong-tea/
│   │   │   ├── red-tea/
│   │   │   ├── dark-tea/
│   │   │   ├── puerh-tea/
│   │   │   ├── yellow-tea/
│   │   │   └── jasmine-tea/
│   │   ├── japan/
│   │   ├── india/
│   │   ├── srilanka/
│   │   ├── korea/
│   │   ├── vietnam/
│   │   └── ... (35 regions total)
│   └── categories/                    # Category descriptions
│
├── import/                            # JSON for import
│   ├── 01-reference/                  # catalogs, tags, brands, packages
│   ├── 02-specifications/             # groups, attributes, options
│   ├── 03-categories/                 # category hierarchy
│   └── 04-products/                   # products by region
│
└── scripts/                           # PowerShell scripts
    ├── Convert-MdToJson.ps1           # MD → JSON converter
    ├── Validate-Import.ps1            # API validation
    ├── Import-Data.ps1                # Import to ProductCatalogService
    └── mappings/                       # Translation/mapping files
        ├── translations.json          # ru-RU/en-US/zh-CN translations
        ├── regions.json               # Region mappings
        └── specifications.json        # Specification mappings
```

## Locales

All data supports three locales (BCP 47 format, aligned with ReferenceService):
- **ru-RU** - Russian (primary language in MD files)
- **en-US** - English
- **zh-CN** - Simplified Chinese (中文)

## Import Order

**Critical**: Import in this exact order due to foreign key dependencies.

1. **01-reference/**
   - `catalogs.json` - 1 catalog
   - `tags.json` - 15 tags
   - `brands.json` - 12 brands
   - `packages.json` - 10 packages

2. **02-specifications/**
   - `specification_groups.json` - 9 groups
   - `specification_attributes.json` - 17 attributes
   - `specification_attribute_options.json` - 8 attribute option sets

3. **03-categories/**
   - `categories.json` - full hierarchy (type + region)

4. **04-products/**
   - `products-*.json` - products by region batches

## Quick Start

### Prerequisites

1. **ProductCatalogService** running on `localhost:5003`
2. **grpcurl** installed (for CLI import)
   - Download: https://github.com/fullstorydev/grpcurl/releases

### 1. Validate All Data

```powershell
# Validate JSON syntax only (service not required)
./scripts/Validate-Import.ps1 -Path ./import/01-reference -Profile catalogs

# Validate against API (service required)
./scripts/Validate-Import.ps1 -Path ./import/01-reference/tags.json -Profile tags
```

### 2. Batch Import (Recommended)

```powershell
# Dry run - validate only
./scripts/Import-Data.ps1 -Batch -DryRun

# Full import
./scripts/Import-Data.ps1 -Batch
```

### 3. Import Single File

```powershell
./scripts/Import-Data.ps1 -Profile tags -File ./import/01-reference/tags.json
./scripts/Import-Data.ps1 -Profile products -File ./import/04-products/products-china-green.json
```

### 4. Convert MD to JSON

```powershell
# Convert all MD files in a directory
./scripts/Convert-MdToJson.ps1 -SourcePath ./docs/regions/japan -OutputPath ./import/04-products

# Convert single file
./scripts/Convert-MdToJson.ps1 -SingleFile ./docs/regions/japan/sencha.md
```

## Data Statistics

| Category | Count |
|----------|-------|
| MD files | 592 |
| Regions | 35 |
| Tea types | 10 (green, white, yellow, oolong, red, dark, pu-erh sheng, pu-erh shu, jasmine, herbal) |
| Specification groups | 9 |
| Tags | 15 |
| Brands | 12 |
| Packages | 10 |
| Categories | ~40 (type + region hierarchy) |

## Specification Groups

| Code | en-US | ru-RU | zh-CN |
|------|-------|-------|-------|
| SPEC-GROUP-CLASSIFICATION | Classification | Классификация | 分类 |
| SPEC-GROUP-ORIGIN | Origin & Terroir | Происхождение и терруар | 产地与风土 |
| SPEC-GROUP-BOTANICAL | Botanical | Ботаника | 植物学 |
| SPEC-GROUP-PROCESSING | Processing | Обработка | 加工工艺 |
| SPEC-GROUP-ORGANOLEPTIC | Tasting Notes | Органолептика | 品鉴特征 |
| SPEC-GROUP-CHEMICAL | Chemical Composition | Химический состав | 化学成分 |
| SPEC-GROUP-BREWING | Brewing | Заваривание | 冲泡 |
| SPEC-GROUP-STORAGE | Storage | Хранение | 储存 |
| SPEC-GROUP-HEALTH | Health Benefits | Польза для здоровья | 健康功效 |

## MD File Format

Each MD file contains 14 numbered sections (in Russian):

1. **Классификация и Происхождение** - Classification & Origin
2. **История и Культурное Значение** - History & Cultural Significance
3. **Ботаническое Описание** - Botanical Description
4. **Терруар и Особенности Выращивания** - Terroir & Growing Conditions
5. **Технология Производства** - Processing Technology
6. **Органолептические Характеристики** - Organoleptic Characteristics
7. **Химический Состав** - Chemical Composition
8. **Полезные Свойства** - Health Benefits
9. **Заваривание** - Brewing Instructions
10. **Хранение** - Storage
11. **Цена и Подделки** - Price & Authenticity
12. **Интересные Факты** - Interesting Facts
13. **Виды чая** - Tea Types/Varieties
14. **Возможные противопоказания** - Contraindications

## Product JSON Format

```json
{
  "code": "TEA-XIHU-LONGJING",
  "sku": "LJ-2024-50G",
  "order": 1,
  "published": true,
  "brand": "BRAND-XIHU",
  "price": 168,
  "translations": [
    { "lang": "ru-RU", "name": "Сиху Лунцзин", "description": "...", "seo": "sihu-luncjin" },
    { "lang": "en-US", "name": "Xihu Longjing", "description": "...", "seo": "xihu-longjing" },
    { "lang": "zh-CN", "name": "西湖龙井", "description": "...", "seo": "xihu-longjing" }
  ],
  "specifications": [
    { "attribute": "SPEC-FERMENTATION", "option": "SPEC-FERM-0", "type": "Option", "showOnPage": true, "order": 1 },
    { "attribute": "SPEC-BREW-TEMP", "type": "CustomText", "value": "70-80°C", "showOnPage": true, "order": 2 }
  ],
  "tags": [{ "code": "TAG-TOP10-CHINA" }, { "code": "TAG-GI-PROTECTED" }],
  "origins": [
    { "country": "CN", "state": "Zhejiang", "place": "Shifeng, Xihu District" }
  ]
}
```

## Related Services

| Service | Description |
|---------|-------------|
| **DKH.ProductCatalogService** | Consumes import JSON via gRPC DataExchange API |
| **DKH.AdminGateway** | Admin interface for catalog management |
| **DKH.StorefrontGateway** | Storefront product display |

## Verification Checklist

- [ ] All JSON files pass schema validation
- [ ] ValidateImport API returns `isValid: true`
- [ ] Test import of 10 products successful
- [ ] Products display in catalog with specifications
- [ ] Translations correct in ru-RU/en-US/zh-CN

## Troubleshooting

### Service not available
```
Error: ProductCatalogService not available at http://localhost:5003
```
Start the service:
```powershell
cd D:\projects\GZDKH\services\DKH.ProductCatalogService
dotnet run --project DKH.ProductCatalogService.Api
```

### grpcurl not found
Download from https://github.com/fullstorydev/grpcurl/releases and add to PATH.

### Import validation errors
Check error messages and fix JSON data. Common issues:
- Missing required fields (code, translations)
- Invalid foreign key references (brand, category codes)
- Duplicate codes

## License

Proprietary - GZDKH Project
