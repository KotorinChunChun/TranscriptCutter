param([string]$OutputRoot='C:/develop/TranscriptCutter-handoff-20261115')
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent)).TrimEnd('\','/')
$OutputRoot=[IO.Path]::GetFullPath($OutputRoot)
if($OutputRoot.StartsWith($repo+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw '引継ぎ出力はプロジェクトの外を指定してください。'}
$stage=Join-Path $OutputRoot 'stage/TranscriptCutter'
New-Item -ItemType Directory -Force $stage | Out-Null
$cacheRoots=@('node_modules/','dist/','dist-web/','src-tauri/target/','src-tauri/gen/','runtime/installer-build/','runtime/unified-build/','runtime/standalone-build/','runtime/unified-source-ece5d0b/','runtime/server115-client-candidate/')
$binary=@('.exe','.dll','.pdb','.lib','.a','.o','.obj','.rlib','.rmeta','.so','.dylib','.pyd','.pyc','.wasm','.onnx','.bin','.ckpt','.pt','.pth','.safetensors','.npy','.npz','.mat','.msi','.msix','.msixbundle','.appx','.zip','.7z','.tar','.gz','.whl','.sqlite3','.sqlite3-shm','.sqlite3-wal')
$media=@('.mp4','.webm','.mov','.mkv','.avi','.mpeg','.mpg','.m4v','.wav','.mp3','.m4a','.flac','.ogg','.aac','.wma','.opus','.media')
$crypto=@('.key','.pfx','.p12','.pem','.cer','.crt','.csr','.srl')
$records=[Collections.Generic.List[object]]::new()
$dirs=[Collections.Generic.List[string]]::new()
function Relative([string]$path){[IO.Path]::GetRelativePath($repo,$path).Replace('\','/')}
function Inventory([string]$directory){
 foreach($entry in Get-ChildItem -LiteralPath $directory -Force){
  $rel=Relative $entry.FullName
  if($rel -eq '.git'){continue}
  if($entry.Attributes -band [IO.FileAttributes]::ReparsePoint){$records.Add([PSCustomObject]@{path=$rel;bytes=0;action='remove-link';reason='junction-cache';sha256=$null});continue}
  if($entry.PSIsContainer){$dirs.Add($entry.FullName);Inventory $entry.FullName;continue}
  $reason='';$ext=$entry.Extension.ToLowerInvariant()
  if($cacheRoots.Where({$rel.StartsWith($_,[StringComparison]::OrdinalIgnoreCase)}).Count){$reason='cache-or-build-output'}
  elseif($rel.StartsWith('runtime/') -and ($rel -match '/(?:node_modules|target|programs|python|models?|ort|tools|app|transcription-server|__pycache__|\.cache|npm-cache|node-compile-cache|cache|runtimes|tmp)/' -or $rel -match '^runtime/(?:web-package-|web-zip-|v\d+-package-|v0[\d.]+-package-|lan-package-|verify-package-|web-package-check-)')){$reason='downloaded-or-extracted-runtime'}
  elseif($ext -in $media){$reason='media-user-authorized'}
  elseif($ext -in $binary -or $entry.Name -match '\.so\.[\d.]+$'){$reason='compiled-or-model-binary'}
  elseif($ext -in $crypto){$reason='temporary-certificate-artifact'}
  elseif($ext -eq '.html' -and [IO.File]::ReadAllText($entry.FullName) -match 'data:(?:audio|video)/[^;]+;base64,[A-Za-z0-9+/]{64}'){$reason='media-user-authorized-embedded'}
  elseif($rel.StartsWith('runtime/') -and $ext -in @('.pid','.lock')){$reason='temporary-process-state'}
  elseif($rel.StartsWith('runtime/') -and ($entry.Name -match '^(?:mode|process|server-process|launcher|certificate-request|settings)\.json$' -or $entry.Name -match '^transformers.*\.js$')){$reason='machine-local-state-or-vendor-cache'}
  elseif($rel.StartsWith('runtime/') -and $ext -in @('.json','.jsonl','.log','.txt','.err') -and $entry.Length -lt 16MB){
   $content=[IO.File]::ReadAllText($entry.FullName)
   if($content -match '(?i)"(?:token|authorization|password|api[_-]?key|client[_-]?secret)"\s*:\s*"[^"\r\n]{16,}"' -or $content -match '-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----'){$reason='temporary-sensitive-state'}
  }
  $hash=if(!$reason){(Get-FileHash -LiteralPath $entry.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}else{$null}
  $records.Add([PSCustomObject]@{path=$rel;bytes=$entry.Length;action=if($reason){'remove'}else{'keep'};reason=if($reason){$reason}else{'source-data-evidence'};sha256=$hash})
 }
}
Inventory $repo
$keep=@($records | Where-Object action -eq 'keep')
Write-Host ('Inventory complete: {0} files, keep {1}.' -f $records.Count,$keep.Count)
foreach($row in $keep){$target=Join-Path $stage $row.path;New-Item -ItemType Directory -Force (Split-Path $target -Parent) | Out-Null;Copy-Item -LiteralPath (Join-Path $repo $row.path) -Destination $target;if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $row.sha256){throw "保持ファイルのコピー不一致: $($row.path)"}}
$remove=@($records | Where-Object action -ne 'keep')
$wholeDirs=[Collections.Generic.List[string]]::new()
$keepDirs=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach($row in $keep){$parent=[IO.Path]::GetDirectoryName((Join-Path $repo $row.path));while($parent -and $parent -ne $repo){[void]$keepDirs.Add($parent);$parent=[IO.Path]::GetDirectoryName($parent)}}
foreach($directory in $dirs | Sort-Object Length){
 $rel=(Relative $directory)+'/'
 if($wholeDirs.Where({$directory.StartsWith($_+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)}).Count){continue}
 if(!$keepDirs.Contains($directory)){$wholeDirs.Add($directory)}
}
$plan=[ordered]@{schemaVersion=1;repository=$repo;output=$OutputRoot;createdAt=(Get-Date).ToUniversalTime().ToString('o');keepFiles=$keep.Count;keepBytes=($keep | Measure-Object bytes -Sum).Sum;removeFiles=$remove.Count;removeBytes=($remove | Measure-Object bytes -Sum).Sum;wholeDirectories=@($wholeDirs | ForEach-Object {Relative $_});records=@($records)}
$plan | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $OutputRoot 'cleanup-plan.json') -Encoding utf8
Copy-Item -LiteralPath (Join-Path $OutputRoot 'cleanup-plan.json') -Destination (Join-Path $stage 'dev/handoff/cleanup-plan.json')
[PSCustomObject]$plan | Select-Object keepFiles,keepBytes,removeFiles,removeBytes,wholeDirectories | ConvertTo-Json -Depth 3
