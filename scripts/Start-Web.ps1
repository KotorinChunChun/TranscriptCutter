param([ValidateRange(0,65535)][int]$Port=0)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
if(!(Get-Command node -ErrorAction SilentlyContinue)){throw 'Node.js 22以降を導入してください。'}
if(!(Test-Path -LiteralPath (Join-Path $taskRoot 'dist-web/index.html'))){throw 'Web画面がありません。開発時はnpm run build:webを実行してください。'}
if($Port){$env:TC_WEB_PORT=[string]$Port}
& node (Join-Path $PSScriptRoot 'serve-web.mjs')
exit $LASTEXITCODE
