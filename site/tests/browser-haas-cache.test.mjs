import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {browserHaasModel,browserHaasAssets,browserHaasCache,haasAssets,haasAssetKey,haasMarkerKey,haasManifestId} from '../browser-haas-config.ts';
import {storeHaasAsset,verifyHaasAsset,browserHaasInstalled,removeBrowserHaas,BrowserHaas} from '../browser-haas.ts';
const origin='http://fixture.test';
const fixture=()=>{const bytes=new TextEncoder().encode('verified model bytes');return {bytes,asset:{id:'fixture',kind:'haas',url:'https://fixture.test/model',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}};};
function memoryCache(){const rows=new Map();return {rows,async match(key){return rows.get(String(key))?.clone();},async put(key,response){rows.set(String(key),new Response(await response.arrayBuffer(),{headers:response.headers}));},async delete(key){return rows.delete(String(key));}};}
test('Haas資産は固定版とSHAを持ちCPUのみ、任意Nemotronを別管理する',()=>{
 assert.equal(browserHaasModel.id,'haas-ja');assert.deepEqual(browserHaasModel.devices,['wasm']);
 assert.equal(browserHaasModel.modelBytes.wasm,382636016);
 assert.equal(new Set(browserHaasAssets.map(a=>a.id)).size,browserHaasAssets.length);
 for(const a of browserHaasAssets){assert.match(a.sha256,/^[a-f0-9]{64}$/);assert.ok(a.bytes>0);assert.ok(!a.url.includes('/resolve/main/'));}
 assert.ok(haasAssets('haas').every(a=>a.kind!=='nemotron'));assert.equal(haasAssets('nemotron').length,4);
});
test('ストリームを検証して保存し、正常キャッシュでは再取得しない',async()=>{
 const {bytes,asset}=fixture(),cache=memoryCache(),signal=new AbortController().signal,events=[];let fetches=0;
 const fetcher=async()=>{fetches++;return new Response(bytes);};
 await storeHaasAsset(cache,asset,signal,p=>events.push(p),origin,fetcher);
 await storeHaasAsset(cache,asset,signal,()=>{},origin,fetcher);
 assert.equal(fetches,1);assert.ok(cache.rows.has(haasAssetKey(asset,origin)));assert.equal(events.at(-1).status,'done');
});
test('不正SHAと切断された取得を導入済みにせず、保存した不正資産を除去する',async()=>{
 const {bytes,asset}=fixture(),cache=memoryCache(),signal=new AbortController().signal;
 await assert.rejects(storeHaasAsset(cache,{...asset,sha256:'0'.repeat(64)},signal,()=>{},origin,async()=>new Response(bytes)),/整合性/);
 assert.equal(cache.rows.size,0);
 await assert.rejects(storeHaasAsset(cache,asset,signal,()=>{},origin,async()=>new Response(bytes.slice(0,3))),/整合性/);
 assert.equal(cache.rows.size,0);
});
test('中止済みの取得はネットワークにアクセスせず、HTTP失敗も保存しない',async()=>{
 const {asset}=fixture(),cache=memoryCache(),controller=new AbortController();controller.abort();let calls=0;
 await assert.rejects(storeHaasAsset(cache,asset,controller.signal,()=>{},origin,async()=>{calls++;return new Response();}),e=>e.name==='AbortError');assert.equal(calls,0);
 await assert.rejects(verifyHaasAsset(new Response('',{status:404}),asset,new AbortController().signal),/404/);assert.equal(cache.rows.size,0);
});
test('マーカー不整合・欠落を拒否し、Haas削除は任意NemotronとWhisperを保持する',async()=>{
 const previousCaches=globalThis.caches,previousLocation=globalThis.location,cache=memoryCache();
 Object.defineProperty(globalThis,'caches',{value:{open:async name=>{assert.equal(name,browserHaasCache);return cache;}},configurable:true});
 Object.defineProperty(globalThis,'location',{value:{origin},configurable:true});
 try{
  for(const a of browserHaasAssets)await cache.put(haasAssetKey(a,origin),new Response('cached'));
  await cache.put('whisper-owned',new Response('keep'));
  for(const kind of ['haas','nemotron'])await cache.put(haasMarkerKey(kind,origin),new Response(JSON.stringify({schema:1,id:haasManifestId(kind)})));
  assert.equal(await browserHaasInstalled(),true);assert.equal(await browserHaasInstalled('nemotron'),true);
  await cache.delete(haasAssetKey(haasAssets('haas')[0],origin));assert.equal(await browserHaasInstalled(),false);
  await removeBrowserHaas('haas');assert.equal(await browserHaasInstalled('nemotron'),true);assert.ok(cache.rows.has('whisper-owned'));
 }finally{Object.defineProperty(globalThis,'caches',{value:previousCaches,configurable:true});Object.defineProperty(globalThis,'location',{value:previousLocation,configurable:true});}
});
test('未導入の認識準備は暗黙にダウンロードしない',async()=>{
 const previousCaches=globalThis.caches,previousLocation=globalThis.location,cache=memoryCache();
 Object.defineProperty(globalThis,'caches',{value:{open:async()=>cache},configurable:true});Object.defineProperty(globalThis,'location',{value:{origin},configurable:true});
 try{await assert.rejects(new BrowserHaas().prepare(new AbortController().signal,()=>{}),/先に導入/);assert.equal(cache.rows.size,0);}
 finally{Object.defineProperty(globalThis,'caches',{value:previousCaches,configurable:true});Object.defineProperty(globalThis,'location',{value:previousLocation,configurable:true});}
});
