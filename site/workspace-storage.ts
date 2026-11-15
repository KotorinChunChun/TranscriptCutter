import {useEffect,useLayoutEffect,useState} from 'react';
import {restorePointPrefix,pointsToKeep} from './src/lib/restore-points';

type SavedRecord={key:string;version:1;data:unknown;assetId:string|null};
type SavedAsset={id:string;blob:Blob;name:string;type:string;lastModified:number};
const records=new Map<string,SavedRecord>(),files=new Map<string,File>();
let fileIds=new WeakMap<File,string>();
const listeners=new Set<()=>void>();
let database:IDBDatabase|null=null,problem='',pending=0,failures=0,resetting=false;
const notify=()=>{for(const listener of listeners)listener();};
const fail=(reason:unknown)=>{failures++;problem=`作業状態を保存・復元できません。タブを閉じる前に編集プロジェクトを保存してください。${reason instanceof Error?reason.message:String(reason)}`;notify();};
const request=<T>(req:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
async function openDatabase(){
 const open=indexedDB.open('transcript-cutter-workspace',1);
 open.onupgradeneeded=()=>{open.result.createObjectStore('records',{keyPath:'key'});open.result.createObjectStore('assets',{keyPath:'id'});};
 return request(open);
}

/** Hydrate before mounting React: empty initial renders must never replace a saved project. */
export async function initializeWorkspaceStorage(){
 try{
  database=await openDatabase();
  database.onversionchange=()=>{database?.close();database=null;fail('保存領域が更新されました。再読み込みしてください。');};
  const tx=database.transaction(['records','assets'],'readonly');
  const rows=await request(tx.objectStore('records').getAll()) as SavedRecord[];
  // Issue all asset reads together while the transaction is active.
  await Promise.all(rows.filter(row=>row.version===1).map(async row=>{
   records.set(row.key,row);
   if(!row.assetId)return;
   const asset=await request(tx.objectStore('assets').get(row.assetId)) as SavedAsset|undefined;
   if(!asset||!(asset.blob instanceof Blob))throw Error('保存した動画・音声が見つかりません。');
   let file=files.get(row.assetId);
   if(!file){file=new File([asset.blob],asset.name,{type:asset.type,lastModified:asset.lastModified});files.set(row.assetId,file);fileIds.set(file,row.assetId);}
  }));
 }catch(error){database?.close();database=null;fail(error);}
}
export function restoredWorkspace<T>(key:string):{data:T;file:File|null}|null{
 const row=records.get(key);return row?{data:row.data as T,file:row.assetId?files.get(row.assetId)??null:null}:null;
}
export function workspaceRestoreError(error:unknown){database?.close();database=null;fail(error);}

export type RestorePoint<T>={key:string;createdAt:number;name:string;data:T;file:File|null};
export function listRestorePoints<T>(workspace:string):RestorePoint<T>[]{
 const prefix=restorePointPrefix(workspace);
 return pointsToKeep([...records.values()].filter(r=>r.key.startsWith(prefix)).map(r=>{
  const value=r.data as {createdAt:number;name:string;data:T};
  return {key:r.key,...value,file:r.assetId?files.get(r.assetId)??null:null};
 }));
}
/** Atomic bounded checkpoints sharing media assets with the live workspace. */
export async function saveRestorePoint<T>(workspace:string,name:string,data:T,file:File|null):Promise<void>{
 if(!database||resetting)throw Error('復元用の保存領域を利用できません。編集プロジェクトを保存してください。');
 if(!name.trim()||name.length>120)throw Error('保存ポイント名は1～120文字で入力してください。');
 const prefix=restorePointPrefix(workspace),key=prefix+crypto.randomUUID(),createdAt=Date.now();
 let assetId=file?fileIds.get(file):null;
 if(file&&!assetId){assetId=crypto.randomUUID();fileIds.set(file,assetId);}
 const row:SavedRecord={key,version:1,data:{name:name.trim(),createdAt,data},assetId:assetId??null};
 await new Promise<void>((resolve,reject)=>{
  const tx=database!.transaction(['records','assets'],'readwrite'),store=tx.objectStore('records');
  let removed:string[]=[];
  store.put(row);
  if(file){const exists=tx.objectStore('assets').getKey(assetId!);exists.onsuccess=()=>{if(exists.result===undefined)tx.objectStore('assets').put({id:assetId!,blob:file,name:file.name,type:file.type,lastModified:file.lastModified} satisfies SavedAsset);};}
  const all=store.getAll();
  all.onsuccess=()=>{
   const rows=all.result as SavedRecord[],points=rows.filter(r=>r.key.startsWith(prefix));
   const keep=new Set(pointsToKeep(points.map(r=>({key:r.key,createdAt:(r.data as {createdAt:number}).createdAt}))).map(r=>r.key));
   removed=points.filter(r=>!keep.has(r.key)).map(r=>r.key);removed.forEach(k=>store.delete(k));
   const used=new Set(rows.filter(r=>!removed.includes(r.key)).map(r=>r.assetId));
   const cursor=tx.objectStore('assets').openCursor();cursor.onsuccess=()=>{const entry=cursor.result;if(!entry)return;if(!used.has(String(entry.key)))entry.delete();entry.continue();};
  };
  pending++;notify();
  tx.oncomplete=()=>{removed.forEach(k=>records.delete(k));records.set(key,row);if(file&&assetId)files.set(assetId,file);pending--;notify();resolve();};
  tx.onabort=()=>{pending--;const error=tx.error??Error('保存容量を確認してください。');fail(error);reject(error);};
 });
}

/** The record and a newly attached media blob commit atomically. No base64 copies. */
export function saveWorkspace(key:string,data:unknown,file:File|null=null){
 if(!database||resetting)return;
 try{
  let assetId=file?fileIds.get(file):null;
  if(file&&!assetId)assetId=crypto.randomUUID();
  if(file&&assetId)fileIds.set(file,assetId);
  const tx=database.transaction(['records','assets'],'readwrite');
  const row:SavedRecord={key,version:1,data,assetId:assetId??null};
  tx.objectStore('records').put(row);
  // Check the committed store, including earlier queued transactions and media cleanup.
  // Metadata edits read only the key; they never clone the video again.
  if(file){const exists=tx.objectStore('assets').getKey(assetId!);exists.onsuccess=()=>{if(exists.result===undefined)tx.objectStore('assets').put({id:assetId!,blob:file,name:file.name,type:file.type,lastModified:file.lastModified} satisfies SavedAsset);};}
  if(records.get(key)?.assetId!==row.assetId){
   const all=tx.objectStore('records').getAll();
   all.onsuccess=()=>{
    const used=new Set((all.result as SavedRecord[]).map(record=>record.assetId));
    const cursor=tx.objectStore('assets').openCursor();
    cursor.onsuccess=()=>{const entry=cursor.result;if(!entry)return;if(!used.has(String(entry.key)))entry.delete();entry.continue();};
   };
  }
  pending++;notify();
  tx.oncomplete=()=>{records.set(key,row);pending--;notify();};
  tx.onabort=()=>{pending--;fail(tx.error??Error('ブラウザーの空き容量を確認してください。'));};
 }catch(error){fail(error);}
}
/** Clear only this app's resume data, after all earlier writes in this database. */
export async function resetWorkspaceStorage(){
 if(resetting)throw Error('リセット中です。');
 resetting=true;pending++;notify();
 let navigation:string|null=null,navigationChanged=false;
 try{
  navigation=localStorage.getItem('tc-workspace-navigation');
  localStorage.removeItem('tc-workspace-navigation');navigationChanged=true;
  database??=await openDatabase();
  await new Promise<void>((resolve,reject)=>{
   const tx=database!.transaction(['records','assets'],'readwrite');
   tx.objectStore('records').clear();tx.objectStore('assets').clear();
   tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error??Error('作業データをリセットできませんでした。'));
  });
  records.clear();files.clear();fileIds=new WeakMap();problem='';
 }catch(error){
  if(navigationChanged){try{if(navigation===null)localStorage.removeItem('tc-workspace-navigation');else localStorage.setItem('tc-workspace-navigation',navigation);}catch{/* Report the original reset failure. */}}
  fail(error);throw error;
 }finally{resetting=false;pending--;notify();}
}
export function useWorkspaceSave(key:string,data:unknown,file:File|null=null){
 useLayoutEffect(()=>{saveWorkspace(key,data,file);},[key,data,file]);
}
export function installWorkspaceReloadGuard(){
 let waiting=false;
 const keydown=(event:KeyboardEvent)=>{
  if(event.key!=='F5'&&!((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='r'))return;
  if(!pending)return;
  event.preventDefault();if(waiting)return;waiting=true;
  const initialFailures=failures;
  const finish=()=>{if(pending)return;listeners.delete(finish);waiting=false;if(failures===initialFailures)location.reload();};
  listeners.add(finish);
 };
 window.addEventListener('keydown',keydown,true);
 return()=>window.removeEventListener('keydown',keydown,true);
}
export function useWorkspaceStorageStatus(){
 const [,update]=useState(0);
 useEffect(()=>{const listener=()=>update(n=>n+1);listeners.add(listener);return()=>{listeners.delete(listener);};},[]);
 return {problem,pending};
}

type Navigation={stage:1|2|3;view:'chat'|'vtt'|'compare'};
export function restoreNavigation():Navigation{
 try{const saved=JSON.parse(localStorage.getItem('tc-workspace-navigation')??'null');
  if(saved&&[1,2,3].includes(saved.stage)&&['chat','vtt','compare'].includes(saved.view))return {stage:saved.stage,view:saved.stage===2?'compare':saved.view==='compare'?'chat':saved.view};
 }catch{/* An invalid preference cannot prevent opening the app. */}
 return {stage:1,view:'chat'};
}
export function saveNavigation(stage:number,view:string){if(resetting)return;try{localStorage.setItem('tc-workspace-navigation',JSON.stringify({stage,view}));}catch(error){fail(error);}}

/** An opaque browser-session identifier, never a server key or operation token. */
export function speechSessionClientId(){
 try{const previous=sessionStorage.getItem('tc-speech-client');if(previous&&/^[a-f0-9-]{36}$/i.test(previous))return previous;const id=crypto.randomUUID();sessionStorage.setItem('tc-speech-client',id);return id;}
 catch{return crypto.randomUUID();}
}
