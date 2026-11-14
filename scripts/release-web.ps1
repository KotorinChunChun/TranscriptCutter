$ErrorActionPreference='Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    & npm.cmd run build:exe
    if($LASTEXITCODE -ne 0){throw '単一EXE作成に失敗しました。'}
    & npm.cmd run check:exe
    if($LASTEXITCODE -ne 0){throw '単一EXE確認に失敗しました。'}
    & node (Join-Path $PSScriptRoot 'build-installers.mjs')
    if($LASTEXITCODE -ne 0){throw 'インストーラー作成に失敗しました。'}
    & node (Join-Path $PSScriptRoot 'check-installers.mjs')
    if($LASTEXITCODE -ne 0){throw 'インストーラー確認に失敗しました。'}
    & node (Join-Path $PSScriptRoot 'publish-unified.mjs')
    if($LASTEXITCODE -ne 0){throw '配布フォルダーの更新に失敗しました。'}
} finally { Pop-Location }
