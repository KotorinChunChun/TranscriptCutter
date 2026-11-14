param([Parameter(Mandatory=$true)][string]$Python)
$ErrorActionPreference='Stop'
$taskRepoRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$taskVenv=Join-Path $taskRepoRoot 'runtime/source-separation/python'
& $Python -m venv $taskVenv
if($LASTEXITCODE -ne 0){throw '専用Python環境を作成できません。'}
$taskPython=Join-Path $taskVenv 'Scripts/python.exe'
& $taskPython -m pip install 'torch==2.6.0+cpu' 'torchaudio==2.6.0+cpu' --index-url https://download.pytorch.org/whl/cpu
if($LASTEXITCODE -ne 0){throw 'CPU版PyTorchを導入できません。'}
& $taskPython -m pip install -r (Join-Path $PSScriptRoot 'requirements.txt')
if($LASTEXITCODE -ne 0){throw '音源分離の実行環境を導入できません。'}
& $taskPython (Join-Path $PSScriptRoot 'prepare.py')
if($LASTEXITCODE -ne 0){throw 'モデルを導入できません。'}
