import {readFile,writeFile,mkdir,readdir,copyFile,cp,access} from 'node:fs/promises';
import {resolve,join,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {prepareReleaseDirectory,pruneObsoleteReleases} from './release-layout.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {version}=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const compiler=process.env.TC_ISCC||'C:/develop/Services/runtime/inno-setup-6.7.3/compiler/ISCC.exe';await access(compiler);
const serverRoot=resolve(process.env.TC_SERVER_RELEASE||'C:/develop/Services/transcription-server/release/v0.1.10/TranscriptionServer');
const serverBuild=JSON.parse(await readFile(join(serverRoot,'BUILD.json'),'utf8'));
if(serverBuild.distribution!=='program-only'||serverBuild.sourceDirty!==false||serverBuild.releaseStatus!=='release'||serverBuild.bundledModels!==false||serverBuild.bundledMediaTools!==false||serverBuild.bundledRecognitionRuntimes!==false)throw Error('サーバーは確定したプログラムのみの配布が必要です。');
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
const serverSha256=await hash(join(serverRoot,'TranscriptionServer.exe'));
if(serverBuild.version!=='0.1.10'||serverBuild.gitCommit!=='8ddfab7b95288a3b11e75735e839471c3b53a09e'||serverSha256!=='2cc4894b9c71b27d6cff3a67945c65bf3679998d7263ab82323ac2a7a8f985fe')throw Error('確定したTranscriptionServer v0.1.10と一致しません。');
const release=await prepareReleaseDirectory(root,version);
const exe=join(release,`TranscriptCutter-web-v${version}.exe`),exeReceipt=JSON.parse(await readFile(exe+'.json','utf8'));
if(await hash(exe)!==exeReceipt.sha256||exeReceipt.version!==version||exeReceipt.sourceDirty!==false)throw Error('コミット済みの一致するEXEを先に生成してください。');
const gitCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
if(gitCommit!==exeReceipt.gitCommit||execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'}).trim())throw Error('配布用ソースをコミットしてからEXEとインストーラーを生成してください。');
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),work=join(root,'runtime','installer-build',stamp);
await mkdir(work,{recursive:true});const processOwner=join(work,'TranscriptCutterProcess.exe');
const resource=join(work,'owner.res'),rc=join(work,'owner.rc'),manifest=join(work,'owner.manifest');
await writeFile(manifest,'<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0"><trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security></trustInfo></assembly>');
await writeFile(rc,`#pragma code_page(65001)\n1 24 ${JSON.stringify(manifest)}\n1 VERSIONINFO\nFILEVERSION ${version.replaceAll('.',',')},0\nPRODUCTVERSION ${version.replaceAll('.',',')},0\nFILEFLAGSMASK 0x3fL\nFILEFLAGS 0\nFILEOS 0x40004L\nFILETYPE 0x1L\nFILESUBTYPE 0\nBEGIN\n BLOCK "StringFileInfo"\n BEGIN\n  BLOCK "040904b0"\n  BEGIN\n   VALUE "ProductName", "TranscriptCutter"\n   VALUE "FileDescription", "TranscriptCutter 専用プロセス管理"\n   VALUE "FileVersion", "${version}.0"\n   VALUE "ProductVersion", "${version}.0"\n   VALUE "OriginalFilename", "TranscriptCutterProcess.exe"\n  END\n END\n BLOCK "VarFileInfo"\n BEGIN\n  VALUE "Translation", 0x409, 1200\n END\nEND\n`);
const resourceCompiler=process.env.TC_RC||'C:/Program Files (x86)/Windows Kits/10/bin/10.0.26100.0/x64/rc.exe';
execFileSync(resourceCompiler,['/nologo','/fo',resource,rc],{stdio:'inherit'});
execFileSync('rustc',['--edition','2024','--target','x86_64-pc-windows-msvc','-C','target-feature=+crt-static','-C','opt-level=s','-C','panic=abort','-C','link-arg='+resource,'-D','warnings',join(root,'packaging','process-owner.rs'),'-o',processOwner],{stdio:'inherit'});
const bundle={schema:1,product:'TranscriptCutter',version,instanceId:'transcript-cutter',serverVersion:serverBuild.version,sourceCommit:serverBuild.gitCommit,serverSha256,processOwnerSha256:await hash(processOwner)};
const artifacts=[];
for(const all of [false,true]){
 const stage=join(work,all?'all-in-one':'normal');await mkdir(stage,{recursive:true});await copyFile(exe,join(stage,'TranscriptCutter.exe'));await copyFile(exe+'.json',join(stage,'BUILD.json'));await copyFile(join(release,`TranscriptCutter-licenses-v${version}.txt`),join(stage,'licenses.txt'));
 const note=`TranscriptCutter v${version}${all?' 完全一体版':''}\n\n起動すると本PC限定のWebサーバーを起動し、ブラウザーを開きます。GUIはブラウザーで操作します。\nファイルはドロップまたはVTT貼付で読み込みます。保存はブラウザーのダウンロードです。\n${all?'TranscriptionServer v'+serverBuild.version+'を専用instance・別ポート・専用データへ起動します。サーバー管理から必要な実行環境とモデルをオンライン導入してください。共有8769とは別の構成です。':'文字起こしは既存TranscriptionServer（初期値 http://127.0.0.1:8769/）またはブラウザーWhisperを使います。'}\nモデル・Python/認識実行環境・FFmpeg/FFprobeは同梱しません。\n${all?'データ/設定/モデル導入先: %LOCALAPPDATA%/TranscriptCutter/all-in-one\n':'起動先保存: %LOCALAPPDATA%/TranscriptCutter/web\n'}使用中・予約済みのポートを避け、次回は自分の起動先を再利用します。\n起動用コンソールを終了するとWebサーバーを終了します。ブラウザーを閉じただけではサーバーは終了しません。\nアンインストールは保存データやモデルを削除しません。先に起動用コンソールを終了してください。\n未署名のWindows x64版です。\nNode.jsとWeb依存物の条件はlicenses.txt、同梱サーバーの条件はtranscription-server/licenses等を参照してください。\n`;
 await writeFile(join(stage,'お読みください.txt'),note);
 if(all){await cp(serverRoot,join(stage,'transcription-server'),{recursive:true,errorOnExist:true,force:false});await copyFile(processOwner,join(stage,'TranscriptCutterProcess.exe'));await writeFile(join(stage,'TranscriptCutter.bundle.json'),JSON.stringify(bundle,null,2)+'\n');const sysroot=execFileSync('rustc',['--print','sysroot'],{encoding:'utf8'}).trim();await copyFile(join(sysroot,'share','doc','rust','COPYRIGHT-library.html'),join(stage,'Rust-standard-library-licenses.html'));}
 const files={};async function inventory(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isSymbolicLink())throw Error('配布にリンクは含めません。');if(entry.isDirectory())await inventory(path);else{const rel=relative(stage,path).replaceAll('\\','/');if(/(?:^|\/)(?:models?|runtime|data|settings|__pycache__|\.git)(?:\/|$)/i.test(rel)||/\.(?:mp4|wav|vtt|sqlite|db|gguf|bin|pth|pt|onnx|key)$/i.test(rel)||/(?:ffmpeg|ffprobe|python)\.exe$/i.test(rel))throw Error('プログラム以外の配布候補: '+rel);files[rel]={sha256:await hash(path),bytes:(await readFile(path)).length};}}}
 await inventory(stage);await writeFile(join(stage,'配布ファイル.json'),JSON.stringify({product:'TranscriptCutter',version,variant:all?'all-in-one':'normal',gitCommit:exeReceipt.gitCommit,server:all?bundle:undefined,files},null,2)+'\n');
 const output=join(release,`TranscriptCutter-${all?'AllInOne-':''}Setup-v${version}.exe`);
 execFileSync(compiler,[`/DVersion=${version}`,`/DSourceDir=${stage}`,`/DOutputDir=${release}`,...(all?['/DAllInOne=1']:[]),join(root,'packaging','TranscriptCutter.iss')],{stdio:'inherit'});
 artifacts.push({file:output,stage,sha256:await hash(output),bytes:(await readFile(output)).length,files:Object.keys(files).length});
}
await writeFile(join(release,`TranscriptCutter-installers-v${version}.json`),JSON.stringify({version,gitCommit:exeReceipt.gitCommit,exe:exeReceipt,server:bundle,artifacts},null,2)+'\n');
await writeFile(join(release,`TranscriptCutter-SHA256-v${version}.txt`),[`${exeReceipt.sha256}  ${exe.split(/[\\/]/).at(-1)}`,...artifacts.map(a=>`${a.sha256}  ${a.file.split(/[\\/]/).at(-1)}`)].join('\n')+'\n');
await pruneObsoleteReleases(root,version);
console.log(JSON.stringify(artifacts,null,2));
