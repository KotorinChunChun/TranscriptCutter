$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'release-web.ps1')
exit $LASTEXITCODE
