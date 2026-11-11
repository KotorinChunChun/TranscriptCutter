$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
& npm.cmd test
if ($LASTEXITCODE -ne 0) { throw '字幕試験に失敗しました。' }
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'ビルドに失敗しました。' }
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
New-Item -ItemType Directory release -Force | Out-Null
$output = Join-Path 'release' "TranscriptCutter-v$version.exe"
Copy-Item -LiteralPath src-tauri/target/release/transcript-cutter.exe -Destination $output
Get-FileHash -Algorithm SHA256 -LiteralPath $output
