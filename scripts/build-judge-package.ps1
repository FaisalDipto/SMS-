param([switch]$IncludeApk)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$OutputDirectory = Join-Path $projectRoot "dist\SMSWeb-Judge-Demo"
$resolvedParent = Join-Path $projectRoot "dist"
New-Item -ItemType Directory -Force -Path $resolvedParent | Out-Null
if (Test-Path -LiteralPath $OutputDirectory) {
    $resolvedOutput = (Resolve-Path -LiteralPath $OutputDirectory).Path
    if (-not $resolvedOutput.StartsWith((Resolve-Path -LiteralPath $resolvedParent).Path)) {
        throw "Refusing to replace a package outside the project dist directory."
    }
    Remove-Item -LiteralPath $OutputDirectory -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

Push-Location (Join-Path $projectRoot "service")
try {
    go build -trimpath -ldflags "-s -w" -o (Join-Path $OutputDirectory "SMSWeb-Demo.exe") .
} finally {
    Pop-Location
}

Copy-Item -LiteralPath (Join-Path $projectRoot "web") `
    -Destination (Join-Path $OutputDirectory "web") -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot "judge\Start SMSWeb Demo.cmd") `
    -Destination $OutputDirectory
Copy-Item -LiteralPath (Join-Path $projectRoot "judge\README.txt") `
    -Destination $OutputDirectory

if ($IncludeApk) {
    $apk = Join-Path $projectRoot "android-bridge\app\build\outputs\apk\debug\app-debug.apk"
    if (-not (Test-Path -LiteralPath $apk)) {
        throw "Android APK not found. Build :app:assembleDebug first."
    }
    Copy-Item -LiteralPath $apk -Destination (Join-Path $OutputDirectory "SMSWeb-Gateway-debug.apk")
}

$archive = "$OutputDirectory.zip"
if (Test-Path -LiteralPath $archive) {
    Remove-Item -LiteralPath $archive -Force
}
Compress-Archive -LiteralPath $OutputDirectory -DestinationPath $archive

Write-Host "Judge folder: $OutputDirectory"
Write-Host "Judge archive: $archive"
