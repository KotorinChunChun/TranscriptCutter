param([ValidateSet('Build','Clean')][string]$Mode='Build',[string]$OutputRoot='C:/develop/TranscriptCutter-handoff-20261115')
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent)).TrimEnd('\','/')
$OutputRoot=[IO.Path]::GetFullPath($OutputRoot).TrimEnd('\','/')
if(!$OutputRoot.StartsWith('C:\develop\',[StringComparison]::OrdinalIgnoreCase) -or $OutputRoot.StartsWith($repo+'\',[StringComparison]::OrdinalIgnoreCase) -or $OutputRoot -eq $repo){throw '引継ぎ出力の境界が不正です。'}
$seven='C:/Program Files/7-Zip/7z.exe';$stage=Join-Path $OutputRoot 'stage';$projectStage=Join-Path $stage 'TranscriptCutter'
$archive=Join-Path $OutputRoot 'TranscriptCutter-handoff-20261115.7z';$planPath=Join-Path $OutputRoot 'cleanup-plan.json'
$plan=Get-Content -LiteralPath $planPath -Raw | ConvertFrom-Json
if([IO.Path]::GetFullPath($plan.repository).TrimEnd('\','/') -ne $repo){throw '対象リポジトリが違います。'}
function Safe-ProjectPath([string]$rel){
 if(!$rel -or [IO.Path]::IsPathRooted($rel) -or $rel -match '(^|/)\.\.?(/|$)' -or $rel -eq '.git' -or $rel.StartsWith('.git/')){throw "削除/保持パスが不正: $rel"}
 $full=[IO.Path]::GetFullPath((Join-Path $repo $rel));if(!$full.StartsWith($repo+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'プロジェクト外のパスです。'};return $full
}
function Hash([string]$path){(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}
if($Mode -eq 'Build'){
 # Documentation may advance after inventory; synchronize only known kept files and Git-tracked source.
 $byPath=@{};foreach($row in $plan.records){$byPath[[string]$row.path]=$row}
 $tracked=@(git -c "safe.directory=$repo" -C $repo ls-files)
 if($LASTEXITCODE -ne 0){throw 'Git一覧取得に失敗しました。'}
 $tracked+=@(Get-ChildItem -LiteralPath (Join-Path $repo 'dev/handoff') -Recurse -File | Where-Object Name -NE 'cleanup-plan.json' | ForEach-Object {[IO.Path]::GetRelativePath($repo,$_.FullName).Replace('\','/')})
 foreach($rel in $tracked){if(!$byPath.ContainsKey($rel)){$row=[PSCustomObject]@{path=$rel;bytes=0;action='keep';reason='source-added-for-handoff';sha256=''};$plan.records+= $row;$byPath[$rel]=$row}}
 foreach($row in $plan.records | Where-Object action -eq 'keep'){
  $source=Safe-ProjectPath $row.path;$row.bytes=(Get-Item -LiteralPath $source).Length;$row.sha256=Hash $source
  $target=Join-Path $projectStage $row.path;New-Item -ItemType Directory -Force (Split-Path $target -Parent) | Out-Null;Copy-Item -LiteralPath $source -Destination $target
 }
 $kept=@($plan.records | Where-Object action -eq 'keep');$plan.keepFiles=$kept.Count;$plan.keepBytes=($kept | Measure-Object bytes -Sum).Sum
 $plan | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $planPath -Encoding utf8
 Copy-Item -LiteralPath $planPath -Destination (Join-Path $projectStage 'dev/handoff/cleanup-plan.json')
 $bundle=Join-Path $stage 'TranscriptCutter.git.bundle';git -c "safe.directory=$repo" -C $repo bundle create $bundle --all
 if($LASTEXITCODE -ne 0){throw 'Git bundle作成失敗'}
 $head=(git -c "safe.directory=$repo" -C $repo rev-parse HEAD).Trim()
 [ordered]@{schemaVersion=1;project='TranscriptCutter';version='0.1.1';sourceCommit=$head;userMessages=132;localAttachments=8;unavailableInlineImages=89;upstreamSourceCommit='55db7303d12c17e56e8d66e993de829ad4bdfb7a';upstreamOrigin='https://github.com/i1643/TranscriptionServer';gitRefs=@(git -c "safe.directory=$repo" -C $repo show-ref);included='sources, Git history, subtitles, projects, research, evidence, image assets';excluded='compiled artifacts, dependencies, models, media, local credentials';createdAt=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $stage 'HANDOFF.json') -Encoding utf8
 $lines=foreach($file in Get-ChildItem -LiteralPath $stage -Recurse -File -Force | Where-Object Name -NE 'FILES.sha256' | Sort-Object FullName){'{0}  {1}' -f (Hash $file.FullName),[IO.Path]::GetRelativePath($stage,$file.FullName).Replace('\','/')}
 $lines | Set-Content (Join-Path $stage 'FILES.sha256') -Encoding utf8
 $temp=Join-Path $OutputRoot 'prepare.7z';if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp -Force}
 Push-Location $stage;try{& $seven a -t7z -mx=7 -mmt=2 -bsp0 -bb0 $temp .;if($LASTEXITCODE -ne 0){throw '7z作成失敗'}}finally{Pop-Location}
 & $seven t -bsp0 $temp;if($LASTEXITCODE -ne 0){throw '7zテスト失敗'}
 $verify=Join-Path $OutputRoot 'verify';if(Test-Path -LiteralPath $verify){if([IO.Path]::GetFullPath($verify) -ne $OutputRoot+'\verify'){throw '照合先境界不正'};Remove-Item -LiteralPath $verify -Recurse -Force}
 & $seven x -bsp0 -y $temp "-o$verify";if($LASTEXITCODE -ne 0){throw '独立展開失敗'}
 $count=0;foreach($line in Get-Content -LiteralPath (Join-Path $verify 'FILES.sha256')){$expected,$rel=$line -split '  ',2;if((Hash (Join-Path $verify $rel)) -ne $expected){throw "展開不一致: $rel"};$count++}
 git -c "safe.directory=$repo" -C $repo bundle verify (Join-Path $verify 'TranscriptCutter.git.bundle');if($LASTEXITCODE -ne 0){throw 'Git bundle検証失敗'}
 $mirror=Join-Path $verify 'git-verify.git';git clone --mirror (Join-Path $verify 'TranscriptCutter.git.bundle') $mirror;if($LASTEXITCODE -ne 0){throw 'Git clone検証失敗'}
 foreach($commit in @($head,'1049da38e2f8d8eb81bfa3002862ea6169db77dd','ece5d0b28194084de2a14e2e6e678edb7c421ff3')){git -c "safe.directory=$mirror" -C $mirror cat-file -e "$commit`^{commit}";if($LASTEXITCODE -ne 0){throw 'worktree履歴不足'}}
 Move-Item -LiteralPath $temp -Destination $archive -Force
 $report=[ordered]@{verified=$true;sourceCommit=$head;archive=$archive;archiveSha256=Hash $archive;planSha256=Hash $planPath;manifestFiles=$count;independentExtraction=$true;allFileHashesMatch=$true;gitBundleClone=$true;verifiedAt=(Get-Date).ToUniversalTime().ToString('o')}
 $report | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $OutputRoot 'archive-check.json') -Encoding utf8
 $report | ConvertTo-Json -Depth 3
 exit 0
}
$check=Get-Content -LiteralPath (Join-Path $OutputRoot 'archive-check.json') -Raw | ConvertFrom-Json
if(!$check.verified -or (Hash $archive) -ne $check.archiveSha256 -or (Hash $planPath) -ne $check.planSha256){throw '検証済みアーカイブ/削除計画が一致しません。'}
foreach($row in $plan.records | Where-Object action -eq 'keep'){if((Hash (Safe-ProjectPath $row.path)) -ne $row.sha256){throw "削除前に保持データが変化: $($row.path)"}}
# Validate all destructive targets and every reparse point before the first removal.
foreach($row in $plan.records | Where-Object action -ne 'keep'){[void](Safe-ProjectPath $row.path)}
foreach($rel in $plan.wholeDirectories){$target=Safe-ProjectPath $rel;if(Test-Path -LiteralPath $target){$links=@(Get-ChildItem -LiteralPath $target -Recurse -Force -Attributes ReparsePoint);foreach($link in $links){$lr=[IO.Path]::GetRelativePath($repo,$link.FullName).Replace('\','/');if(!($plan.records | Where-Object { $_.action -eq 'remove-link' -and $_.path -eq $lr })){throw '未計画のリンクがあります。'}}}}
foreach($rel in @('runtime/server115-client-candidate','runtime/unified-source-ece5d0b')){$path=Safe-ProjectPath $rel;if(Test-Path -LiteralPath $path){$dirty=git -c "safe.directory=$path" -C $path status --porcelain --untracked-files=all;if($LASTEXITCODE -ne 0 -or $dirty){throw 'worktreeに未保存の変更があります。'}}}
foreach($row in $plan.records | Where-Object action -eq 'remove-link'){$path=Safe-ProjectPath $row.path;if(Test-Path -LiteralPath $path){[IO.Directory]::Delete($path)}}
foreach($rel in @('runtime/server115-client-candidate','runtime/unified-source-ece5d0b')){$path=Safe-ProjectPath $rel;if(Test-Path -LiteralPath $path){git -c "safe.directory=$repo" -c core.longpaths=true -C $repo worktree remove --force $path;if($LASTEXITCODE -ne 0){throw 'worktreeの削除に失敗しました。'}}}
foreach($rel in $plan.wholeDirectories){$path=Safe-ProjectPath $rel;if(Test-Path -LiteralPath $path){Remove-Item -LiteralPath $path -Recurse -Force}}
foreach($row in $plan.records | Where-Object action -eq 'remove'){$path=Safe-ProjectPath $row.path;if(Test-Path -LiteralPath $path){Remove-Item -LiteralPath $path -Force}}
foreach($row in $plan.records | Where-Object action -eq 'keep'){if((Hash (Safe-ProjectPath $row.path)) -ne $row.sha256){throw "削除後の保持不一致: $($row.path)"}}
$remaining=@($plan.records | Where-Object { $_.action -ne 'keep' -and (Test-Path -LiteralPath (Safe-ProjectPath $_.path)) });if($remaining.Count){throw '削除対象が残っています。'}
$report=[ordered]@{completed=$true;removedFiles=$plan.removeFiles;removedBytes=$plan.removeBytes;retainedFiles=@($plan.records | Where-Object action -eq 'keep').Count;allRetainedHashesUnchanged=$true;plannedRemovalRemaining=0;gitHistoryPreserved=$true;preDeletionArchiveSha256=$check.archiveSha256;completedAt=(Get-Date).ToUniversalTime().ToString('o')}
$report | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $repo 'dev/handoff/cleanup-result.json') -Encoding utf8
Copy-Item -LiteralPath (Join-Path $repo 'dev/handoff/cleanup-result.json') -Destination (Join-Path $OutputRoot 'cleanup-result.json')
$report | ConvertTo-Json -Depth 3
