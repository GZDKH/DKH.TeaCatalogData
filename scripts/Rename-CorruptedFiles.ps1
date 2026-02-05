<#
.SYNOPSIS
    Renames files with corrupted names by reading the first line and translating to English.
#>

param(
    [string]$Path = ".\docs\regions",
    [switch]$WhatIf = $false
)

# Dictionary of Russian tea terms to English
$translations = @{
    # Tea types
    "Черный Чай" = "Black Tea"
    "Красный Чай" = "Red Tea"
    "Зеленый Чай" = "Green Tea"
    "Белый Чай" = "White Tea"
    "Улун" = "Oolong"
    "Пуэр" = "Puer"

    # Regions
    "Юньнаньский" = "Yunnan"
    "Фуцзяньский" = "Fujian"
    "Гуйчжоуский" = "Guizhou"
    "Тайваньский" = "Taiwan"
    "Японский" = "Japanese"
    "Индийский" = "Indian"

    # Descriptors
    "Дикий" = "Wild"
    "Пурпурный" = "Purple"
    "Высокогорный" = "High Mountain"
    "Золотой" = "Golden"
    "Серебряные" = "Silver"
    "Органический" = "Organic"

    # Specific teas
    "Мей Жэнь" = "Mei Ren"
    "Хун Ча" = "Hong Cha"
    "Хун Фэн Гао Сян" = "Hong Feng Gao Xiang"
    "Цзинь Мудань" = "Jin Mudan"
    "Улян" = "Wuliang"
    "Личи" = "Lychee"
    "Кошачья пещера" = "Cats Cave"
    "Пион" = "Peony"
    "Красавица" = "Beauty"
    "Иглы" = "Needles"
    "Дракон" = "Dragon"
    "Туман" = "Mist"
    "Горный" = "Mountain"
    "Драгоценной Наложницы" = "Imperial Concubine"
    "Кабан" = "Wild Boar"
    "Ройбуш" = "Rooibos"
    "Гуй Фэй" = "Gui Fei"
    "Бай Хао Инь Чжэнь" = "Bai Hao Yin Zhen"
    "Шангрила" = "Shangri-La"
    "Золотые Типсы" = "Golden Tips"
    "Эрл Грей" = "Earl Grey"
    "Ваниль" = "Vanilla"
    "Стержень" = "Stem"
    "Декафиенизированный" = "Decaffeinated"
    "без кофеина" = "Decaf"
    "Матча" = "Matcha"
    "Маття" = "Matcha"
    "Чай Нилгири" = "Nilgiri Tea"
    "Чай Ассам" = "Assam Tea"
    "Бенифуки Вакоча" = "Benifuki Wakocha"
    "Премиальный" = "Premium"
    "Лепестков" = "Petals"
    "Лотоса" = "Lotus"
    "Семян" = "Seeds"
    "Гибискус" = "Hibiscus"
    "Каркаде" = "Hibiscus"
    "Сердцевина" = "Heart"
    "Лимон" = "Lemon"
    "Хризантемы" = "Chrysanthemum"
    "Ромашковый" = "Chamomile"
    "Мятный" = "Mint"
    "Лилии" = "Lily"
    "Бергамот" = "Bergamot"
    "Сенны" = "Senna"
    "Османтуса" = "Osmanthus"
    "Саган-Дайля" = "Sagan Dailya"
    "Роза" = "Rose"
    "Жасминовый" = "Jasmine"
    "Яблони" = "Apple Blossom"
    "Гвоздика" = "Carnation"
}

function Convert-RussianToEnglish {
    param([string]$text)

    # Remove markdown headers and extra characters
    $text = $text -replace "^#\s*#?\s*", ""
    $text = $text -replace "[«»""''()]", ""
    $text = $text.Trim()

    # Apply translations
    foreach ($key in $translations.Keys) {
        $text = $text -replace $key, $translations[$key]
    }

    # Remove remaining Cyrillic
    $text = $text -replace "[а-яА-ЯёЁ]+", ""

    # Convert to kebab-case
    $text = $text.ToLower()
    $text = $text -replace "\s+", "-"
    $text = $text -replace "-+", "-"
    $text = $text -replace "[^a-z0-9\-]", ""
    $text = $text.Trim("-")

    # Limit length
    if ($text.Length -gt 50) {
        $text = $text.Substring(0, 50).TrimEnd("-")
    }

    return $text
}

# Main
$corruptedFiles = Get-ChildItem -Path $Path -Recurse -Filter "*.md" | Where-Object {
    $_.Name -match "^#" -or $_.Name -match "╨" -or $_.Name -match "[\u0400-\u04FF]"
}

Write-Host "=== Renaming Corrupted Files ===" -ForegroundColor Cyan
Write-Host "Found: $($corruptedFiles.Count) files"
Write-Host "WhatIf: $WhatIf"
Write-Host ""

$renamed = 0
$errors = 0

foreach ($file in $corruptedFiles) {
    try {
        # Read first line
        $firstLine = Get-Content $file.FullName -TotalCount 1 -Encoding UTF8

        if ([string]::IsNullOrWhiteSpace($firstLine)) {
            Write-Host "[SKIP] $($file.Name) - empty first line" -ForegroundColor Yellow
            continue
        }

        $newBaseName = Convert-RussianToEnglish $firstLine

        if ([string]::IsNullOrWhiteSpace($newBaseName)) {
            Write-Host "[SKIP] $($file.Name) - could not generate name from: $firstLine" -ForegroundColor Yellow
            continue
        }

        $newName = "$newBaseName.md"

        # Check for duplicates
        $counter = 1
        $finalName = $newName
        while (Test-Path (Join-Path $file.DirectoryName $finalName)) {
            $finalName = "$newBaseName-$counter.md"
            $counter++
        }

        Write-Host "$($file.Name)"
        Write-Host "  Title: $firstLine"
        Write-Host "  -> $finalName" -ForegroundColor Green

        if (-not $WhatIf) {
            Rename-Item -Path $file.FullName -NewName $finalName -ErrorAction Stop
            $renamed++
        } else {
            $renamed++
        }
    }
    catch {
        Write-Host "  [ERROR] $($_.Exception.Message)" -ForegroundColor Red
        $errors++
    }
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Renamed: $renamed"
Write-Host "Errors: $errors"
