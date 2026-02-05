$ErrorActionPreference = "Continue"
$files = Get-ChildItem -Path "D:\projects\GZDKH\DKH.TeaCatalogData\docs\regions" -Recurse -Filter "*.md" | Where-Object { $_.Name -match "^#" }

$map = @{
    # Sri Lanka
    "Дикий Черный Чай Ваниль" = "wild-vanilla-black-tea"
    "Эрл Грей" = "earl-grey"
    "Декафиенизированный Чай" = "decaffeinated-tea"

    # Japan
    "Японский чёрный чай Бенифуки Вакоча" = "japanese-benifuki-wakocha"
    "Чай Матча" = "matcha-tea"

    # China Oolong
    "Бэй Доу" = "bei-dou-big-dipper"
    "Фуцзянь Баньян" = "fujian-huang-mei-gui-oolong"
    "Тайваньский Улун.*Шуй Сянь" = "taiwan-shui-xian-oolong"
    "Дан Цун Бай Жуй Сян" = "dan-cong-bai-rui-xiang"

    # China Red
    "Мей Жэнь Хун Ча" = "mei-ren-hong-cha"
    "Юньнаньский Дикий Пурпурный Черный" = "yunnan-wild-purple-black-tea"
    "Юньнаньский Улян Черный" = "yunnan-wuliang-black-tea"
    "Цзинь Мудань" = "jin-mudan-golden-peony"
    "Фуцзяньский Высокогорный Черный" = "fujian-high-mountain-black-tea"
    "Хун Фэн Гао Сян" = "hong-feng-gao-xiang"
    "Гуйчжоуский черный чай.*Кошачья пещера" = "guizhou-cats-cave-black-tea"
    "Черный Чай с Личи" = "lychee-black-tea"

    # China White
    "Юньнаньский Дикий Пурпурный Белый" = "yunnan-wild-purple-white-tea"

    # India
    "Чай Нилгири" = "nilgiri-tea"
    "Чай Ассам" = "assam-tea"

    # Kenya
    "Бай Хао Инь Чжэнь.*Серебряные" = "bai-hao-yin-zhen-silver-needle"

    # Nepal
    "Золотые Типсы" = "golden-tips"
    "Зеленый Чай Шангрила" = "shangri-la-green-tea"

    # Vietnam
    "Гуй Фэй Улун" = "gui-fei-oolong"
    "Дикий Белый Чай.*Горный Туман" = "wild-mountain-mist-white-tea"
    "Дикий Черный Чай.*Фин Хо" = "fin-ho-wild-black-tea"
    "Дикий Кабан.*Черный" = "wild-boar-black-tea"
    "Красный органический чай.*Ройбуш" = "rooibos-red-tea"

    # Jersey
    "Премиальный Зеленый Чай.*Джерси" = "jersey-premium-green-tea"

    # Flowers
    "Шаньчжа Гань" = "shanzha-hawthorn"
    "Лянцзы Синь.*Лотоса" = "lotus-seed-heart"
    "Лошэнь Хуа.*Каркаде" = "hibiscus-luoshen"
    "Мудань Хуа.*Пиона" = "peony-petals"
    "Нинмэн Пянь" = "lemon-slices"
    "Юэцзи Хуа" = "chinese-rose"
    "Ян Гань Цзюй.*Ромашковый" = "chamomile"
    "Цзянсу Тай Цзюй" = "jiangsu-chrysanthemum"
    "Цзинь Чжань Хуа" = "calendula"
    "Бохэ Е.*Мятный" = "mint-leaf"
    "Байхэ Хуа.*Лилии" = "lily-flower"
    "Сян Нин Мэн.*Бергамот" = "bergamot"
    "Фань Се Е.*Сенны" = "senna-leaf"
    "Гуйхуа Ча.*Османтуса" = "osmanthus"
    "Дуцзюань Хуа.*Саган-Дайля" = "sagan-dailya-rhododendron"
    "Да Хун Мэйгуй.*Красная Роза" = "big-red-rose"
    "Жасминовый чай Моли Хуа" = "jasmine-molihua"
    "Ку Дин Ча" = "ku-ding-bitter"
    "Каннайсинь Хуа" = "carnation"
    "Пинго Хуа.*Яблони" = "apple-blossom"
    "Чэньпи Сы" = "chenpi-tangerine-peel"
    "Чжу Е Ча" = "bamboo-leaf"
    "Чай.*Таохуа" = "taohua-peach-blossom"
    "Чай Цзиньиньхуа" = "honeysuckle"
    "Чай Хэ Е" = "lotus-leaf"
    "Чай Джуджуба" = "jujube"
    "Чай из белой хризантемы" = "white-chrysanthemum"
}

foreach ($file in $files) {
    $firstLine = Get-Content $file.FullName -TotalCount 1 -Encoding UTF8
    $newName = $null

    foreach ($pattern in $map.Keys) {
        if ($firstLine -match $pattern) {
            $newName = $map[$pattern]
            break
        }
    }

    if ($newName) {
        $ext = ".md"
        $finalName = "$newName$ext"
        $counter = 1
        while (Test-Path (Join-Path $file.DirectoryName $finalName)) {
            $finalName = "$newName-$counter$ext"
            $counter++
        }

        Write-Host "$($file.Name) -> $finalName"
        Rename-Item -Path $file.FullName -NewName $finalName
    } else {
        Write-Host "SKIP: $($file.Name) - $firstLine"
    }
}
