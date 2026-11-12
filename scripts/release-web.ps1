$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
Push-Location $taskRoot
try {
    & npm.cmd run check:web
    if($LASTEXITCODE -ne 0){throw '型検査に失敗しました。'}
    & npm.cmd run build:web
    if($LASTEXITCODE -ne 0){throw 'Webビルドに失敗しました。'}
    $version=(Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version
    $stage=Join-Path $taskRoot ("runtime/web-package-"+[guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path (Join-Path $stage 'scripts') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $taskRoot 'dist-web') -Destination $stage -Recurse
    Copy-Item -LiteralPath (Join-Path $taskRoot 'README.md') -Destination $stage
    foreach($name in @('serve-web.mjs','standalone-web.mjs','speech-connection.mjs','Start-Web.ps1','benchmark-models.mjs','compare-benchmark-text.mjs')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $stage 'scripts')}
    New-Item -ItemType Directory -Path (Join-Path $stage 'web') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $taskRoot 'web/transcript-utils.mjs') -Destination (Join-Path $stage 'web')
    $destination=Join-Path $taskRoot "release/TranscriptCutter-web-v$version.zip"
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $destination -Force
    Get-FileHash -Algorithm SHA256 -LiteralPath $destination
} finally { Pop-Location }
