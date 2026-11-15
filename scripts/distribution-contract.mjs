import {readFile,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

export const bundledServerRelease=Object.freeze({
 version:'0.1.15',gitCommit:'55db7303d12c17e56e8d66e993de829ad4bdfb7a',
 sha256:'3c9277b1cabb40a8d7cfea995b285d31c7a8848ee4687b4ea4af4d06768fc266',
 directory:'C:/develop/Services/transcription-server/release/v0.1.15/TranscriptionServer',
});
export const sha256=data=>createHash('sha256').update(data).digest('hex');
export const requiredWebAssets=Object.freeze([
 '/index.html','/app.js','/app.css','/browser-whisper-worker.js','/browser-haas-worker.js',
 ...['HAAS-LICENSE','HAAS-NOTICE','NEMOTRON-MODEL-LICENSE','ONNXRUNTIME-LICENSE','SILERO-LICENSE','TRANSFORMERS-LICENSE'].map(name=>'/licenses/local-asr/'+name),
]);
export function verifyServerRelease(receipt,bytes){
 const expected=bundledServerRelease;
 if(receipt.version!==expected.version||receipt.gitCommit!==expected.gitCommit||sha256(bytes)!==expected.sha256||receipt.sourceDirty!==false||receipt.distribution!=='program-only'||receipt.releaseStatus!=='release'||receipt.bundledModels!==false||receipt.bundledMediaTools!==false||receipt.bundledRecognitionRuntimes!==false)throw Error('確定したプログラムのみのTranscriptionServer v'+expected.version+'が必要です。');
}
export async function collectWebAssets(directory){
 if((await lstat(directory)).isSymbolicLink())throw Error('Web資産のリンク・パスを確認してください。');
 const assets={};
 async function walk(dir,prefix=''){
  for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   if(entry.isSymbolicLink()||!/^[-A-Za-z0-9._]+$/.test(entry.name)||entry.name==='.'||entry.name==='..')throw Error('Web資産のリンク・パスを確認してください。');
   const name=prefix+'/'+entry.name,path=join(dir,entry.name);
   if(entry.isDirectory())await walk(path,name);
   else if(entry.isFile())assets[name]=(await readFile(path)).toString('base64');
   else throw Error('通常ファイル以外はWebへ同梱しません。');
  }
 }
 await walk(directory);
 for(const name of requiredWebAssets)if(!assets[name])throw Error('同梱するWeb資産がありません: '+name);
 return assets;
}
export function verifyAcceptedExecutable(receipt,acceptance,bytes,version){
 if(receipt.version!==version||receipt.sourceDirty!==false||receipt.distribution!=='unified-single-exe'||receipt.server?.version!==bundledServerRelease.version||receipt.server.gitCommit!==bundledServerRelease.gitCommit||receipt.server.sha256!==bundledServerRelease.sha256||receipt.sha256!==sha256(bytes)||acceptance?.version!==version||acceptance?.source!==receipt.gitCommit||acceptance?.sha256!==receipt.sha256||!Array.isArray(acceptance?.passed)||acceptance.passed.length<8)throw Error('確認済みの単一EXEを指定してください。');
 for(const name of requiredWebAssets)if(!/^[a-f0-9]{64}$/.test(receipt.assets?.[name]??''))throw Error('確認済みEXEのWeb資産が不足しています: '+name);
}
export const installerName=version=>`TranscriptCutter-v${version}-setup-x64.exe`;
export function verifyAcceptedInstaller(receipt,acceptance,bytes,executable,version){
 if(receipt.version!==version||receipt.distribution!=='unified-user-installer'||receipt.sha256!==sha256(bytes)||receipt.bytes!==bytes.length||receipt.executable?.sha256!==executable.sha256||receipt.executable.gitCommit!==executable.gitCommit||receipt.server?.version!==bundledServerRelease.version||receipt.server.sha256!==bundledServerRelease.sha256||receipt.server.gitCommit!==bundledServerRelease.gitCommit||receipt.installScope!=='current-user'||receipt.autoRun!==false||receipt.dataPreserved!==true||!/^[a-f0-9]{64}$/.test(receipt.compiler?.sha256??'')||!/^[a-f0-9]{64}$/.test(receipt.installerScriptSha256??'')||acceptance?.version!==version||acceptance?.source!==executable.gitCommit||acceptance?.executableSha256!==executable.sha256||acceptance?.sha256!==receipt.sha256||!Array.isArray(acceptance?.passed)||acceptance.passed.length<7)throw Error('確認済みEXEに対応するインストーラーを指定してください。');
}
