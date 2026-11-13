import {lstat,mkdir,readFile,readdir,realpath,rm} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function releaseDirectory(root,version){
 if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('配布バージョンが不正です。');
 return resolve(root,'release','v'+version);
}
async function inspect(path,base){
 const stat=await lstat(path);
 if(stat.isSymbolicLink())throw Error('配布フォルダー内のリンクは操作しません: '+path);
 const actual=await realpath(path),rel=relative(base,actual);
 if(!rel||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../')||isAbsolute(rel))throw Error('配布フォルダー外は操作しません: '+path);
 if(stat.isDirectory())for(const entry of await readdir(path))await inspect(join(path,entry),base);
}
export async function prepareReleaseDirectory(root,version){
 const current=releaseDirectory(root,version),base=resolve(root,'release');
 await mkdir(base,{recursive:true});
 if((await lstat(base)).isSymbolicLink())throw Error('releaseのリンクは操作しません。');
 await mkdir(current,{recursive:true});
 await inspect(current,await realpath(base));
 return current;
}
export async function pruneObsoleteReleases(root,version){
 const current=releaseDirectory(root,version),base=resolve(root,'release');
 if((await lstat(base)).isSymbolicLink())throw Error('releaseのリンクは操作しません。');
 const actualBase=await realpath(base);
 await inspect(current,actualBase);
 const names=await readdir(current);
 if(!names.some(name=>name===`TranscriptCutter-web-v${version}.exe`||name===`TranscriptCutter-web-v${version}.zip`))throw Error('現行配布物がないため旧版は削除しません。');
 const obsolete=[];
 for(const name of await readdir(base)){
  if(name==='v'+version)continue;
  if(name==='history'||/^v\d+\.\d+\.\d+(?:-[a-f0-9]+)?$/.test(name)||/^TranscriptCutter-.*-v\d+\.\d+\.\d+\.(?:exe(?:\.json)?|zip|json|txt)$/.test(name)||/^v\d+\.\d+\.\d+-配布案内\.txt$/.test(name))obsolete.push(join(base,name));
 }
 // 全対象の境界とリンクを先に検証し、途中まで削除した状態で検証エラーにしない。
 for(const path of obsolete)await inspect(path,actualBase);
 for(const path of obsolete)await rm(path,{recursive:true,force:false});
 return obsolete;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
 const {version}=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
 if(process.argv[2]==='--prepare')console.log(await prepareReleaseDirectory(root,version));
 else if(process.argv[2]==='--prune')console.log(JSON.stringify(await pruneObsoleteReleases(root,version)));
 else throw Error('--prepareまたは--pruneを指定してください。');
}
