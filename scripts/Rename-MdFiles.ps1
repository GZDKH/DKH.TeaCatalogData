<#
.SYNOPSIS
    Renames MD files to clean kebab-case format.
.DESCRIPTION
    Removes # prefix, extracts English name, converts to kebab-case.
#>

param(
    [string]$Path = ".\docs\regions",
    [switch]$WhatIf = $false
)

function Convert-ToKebabCase {
    param([string]$name)

    # Remove # prefix
    $name = $name -replace "^#\s*", ""

    # Try to extract English part from parentheses or before parentheses
    if ($name -match "^([A-Za-z][A-Za-z0-9\s'\-]+)") {
        $name = $Matches[1].Trim()
    }
    elseif ($name -match "\(([A-Za-z][A-Za-z0-9\s'\-]+)\)") {
        $name = $Matches[1].Trim()
    }

    # Remove Chinese characters
    $name = $name -replace "[\u4e00-\u9fff]+", ""

    # Remove pinyin tone marks and special chars
    $name = $name -replace "[`'`"`'\(\)\[\]\{\}]", ""

    # Transliterate common Russian to English
    $ruToEn = @{
        [char]0x0410 = "A";  [char]0x0430 = "a"   # А а
        [char]0x0411 = "B";  [char]0x0431 = "b"   # Б б
        [char]0x0412 = "V";  [char]0x0432 = "v"   # В в
        [char]0x0413 = "G";  [char]0x0433 = "g"   # Г г
        [char]0x0414 = "D";  [char]0x0434 = "d"   # Д д
        [char]0x0415 = "E";  [char]0x0435 = "e"   # Е е
        [char]0x0401 = "Yo"; [char]0x0451 = "yo"  # Ё ё
        [char]0x0416 = "Zh"; [char]0x0436 = "zh"  # Ж ж
        [char]0x0417 = "Z";  [char]0x0437 = "z"   # З з
        [char]0x0418 = "I";  [char]0x0438 = "i"   # И и
        [char]0x0419 = "Y";  [char]0x0439 = "y"   # Й й
        [char]0x041A = "K";  [char]0x043A = "k"   # К к
        [char]0x041B = "L";  [char]0x043B = "l"   # Л л
        [char]0x041C = "M";  [char]0x043C = "m"   # М м
        [char]0x041D = "N";  [char]0x043D = "n"   # Н н
        [char]0x041E = "O";  [char]0x043E = "o"   # О о
        [char]0x041F = "P";  [char]0x043F = "p"   # П п
        [char]0x0420 = "R";  [char]0x0440 = "r"   # Р р
        [char]0x0421 = "S";  [char]0x0441 = "s"   # С с
        [char]0x0422 = "T";  [char]0x0442 = "t"   # Т т
        [char]0x0423 = "U";  [char]0x0443 = "u"   # У у
        [char]0x0424 = "F";  [char]0x0444 = "f"   # Ф ф
        [char]0x0425 = "Kh"; [char]0x0445 = "kh"  # Х х
        [char]0x0426 = "Ts"; [char]0x0446 = "ts"  # Ц ц
        [char]0x0427 = "Ch"; [char]0x0447 = "ch"  # Ч ч
        [char]0x0428 = "Sh"; [char]0x0448 = "sh"  # Ш ш
        [char]0x0429 = "Shch"; [char]0x0449 = "shch" # Щ щ
        [char]0x042A = "";   [char]0x044A = ""    # Ъ ъ
        [char]0x042B = "Y";  [char]0x044B = "y"   # Ы ы
        [char]0x042C = "";   [char]0x044C = ""    # Ь ь
        [char]0x042D = "E";  [char]0x044D = "e"   # Э э
        [char]0x042E = "Yu"; [char]0x044E = "yu"  # Ю ю
        [char]0x042F = "Ya"; [char]0x044F = "ya"  # Я я
    }

    $result = ""
    foreach ($char in $name.ToCharArray()) {
        if ($ruToEn.ContainsKey($char)) {
            $result += $ruToEn[$char]
        } else {
            $result += $char
        }
    }
    $name = $result

    # Convert to lowercase
    $name = $name.ToLower()

    # Replace spaces and multiple dashes with single dash
    $name = $name -replace "\s+", "-"
    $name = $name -replace "-+", "-"

    # Remove non-alphanumeric except dash
    $name = $name -replace "[^a-z0-9\-]", ""

    # Trim dashes
    $name = $name.Trim("-")

    # Limit length
    if ($name.Length -gt 60) {
        $name = $name.Substring(0, 60).TrimEnd("-")
    }

    return $name
}

# Main
$files = Get-ChildItem -Path $Path -Filter "*.md" -Recurse -File
$renamed = 0
$skipped = 0
$errors = 0

Write-Host "=== Renaming MD Files ===" -ForegroundColor Cyan
Write-Host "Path: $Path"
Write-Host "Files: $($files.Count)"
Write-Host "WhatIf: $WhatIf"
Write-Host ""

foreach ($file in $files) {
    $oldName = $file.Name
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($oldName)
    $newBaseName = Convert-ToKebabCase $baseName

    if ([string]::IsNullOrWhiteSpace($newBaseName)) {
        Write-Host "[SKIP] $oldName - could not generate new name" -ForegroundColor Yellow
        $skipped++
        continue
    }

    $newName = "$newBaseName.md"

    # Check for duplicates in same directory
    $counter = 1
    $finalName = $newName
    while (Test-Path (Join-Path $file.DirectoryName $finalName)) {
        if ($finalName -eq $oldName) { break }
        $finalName = "$newBaseName-$counter.md"
        $counter++
    }

    if ($finalName -eq $oldName) {
        $skipped++
        continue
    }

    $newPath = Join-Path $file.DirectoryName $finalName

    Write-Host "$oldName"
    Write-Host "  -> $finalName" -ForegroundColor Green

    if (-not $WhatIf) {
        try {
            Rename-Item -Path $file.FullName -NewName $finalName -ErrorAction Stop
            $renamed++
        }
        catch {
            Write-Host "  [ERROR] $($_.Exception.Message)" -ForegroundColor Red
            $errors++
        }
    } else {
        $renamed++
    }
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Renamed: $renamed"
Write-Host "Skipped: $skipped"
Write-Host "Errors: $errors"
