import {mkdir,readFile,writeFile,rename,lstat} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash,randomUUID} from 'node:crypto';
const hash=data=>createHash('sha256').update(data).digest('hex');

// Only a fixed build-time manifest is extracted. No archive-supplied paths or links.
export async function extractProgram(payload,stateDir){
 if(!payload||!/^\d+\.\d+\.\d+$/.test(payload.version)||!/^[a-f0-9]{64}$/.test(payload.sha256))throw Error('内包プログラムの構成が不正です。');
 const archive=Buffer.from(payload.gzip,'base64');
 if(hash(archive)!==payload.sha256)throw Error('内包プログラムが破損しています。');
 const files=JSON.parse(gunzipSync(archive,{maxOutputLength:80*1024*1024}).toString('utf8'));
 if(!Array.isArray(files)||!files.length||files.length>2000)throw Error('内包ファイル一覧が不正です。');
 for(const file of files){
  if(typeof file.path!=='string'||!file.path||file.path.includes('\\')||file.path.split('/').some(p=>!p||p==='.'||p==='..'||/[:\x00-\x1f]/.test(p))||isAbsolute(file.path)||!/^[a-f0-9]{64}$/.test(file.sha256)||hash(Buffer.from(file.body,'base64'))!==file.sha256)throw Error('内包ファイルの検証に失敗しました。');
 }
 const home=resolve(stateDir,'programs'),target=join(home,`v${payload.version}-${payload.sha256.slice(0,16)}`);
 // Reject junctions in existing ancestors, including the user-configured state root.
 for(let p=target;;){try{if((await lstat(p)).isSymbolicLink())throw Error('展開先のリンクは使用できません。');}catch(error){if(error.code!=='ENOENT')throw error;}const parent=resolve(p,'..');if(parent===p)break;p=parent;}
 const check=async()=>{for(const file of files){const path=resolve(target,file.path),rel=relative(target,path);if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('展開先が不正です。');if((await lstat(path)).isSymbolicLink()||hash(await readFile(path))!==file.sha256)throw Error('展開済みプログラムが変更されています。');}};
 try{await lstat(target);await check();return target;}catch(error){if(error.code!=='ENOENT')throw error;}
 await mkdir(home,{recursive:true});const stage=join(home,'prepare-'+randomUUID());await mkdir(stage);
 for(const file of files){const path=join(stage,file.path);await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,Buffer.from(file.body,'base64'),{flag:'wx'});}
 await rename(stage,target);await check();return target;
}
