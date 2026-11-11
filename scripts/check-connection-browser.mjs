import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createWebServer} from './serve-web.mjs';
const listen=s=>new Promise(resolve=>s.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${s.address().port}`)));
const stop=s=>{s.closeAllConnections();return new Promise(resolve=>s.close(resolve));};
function upstream(mode){return createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(mode==='bearer'&&req.headers.authorization!=='Bearer fixture-browser-key'){res.writeHead(401).end('{"error":"サーバーの接続キーを確認してください。"}');return;}res.end(JSON.stringify(req.url==='/api/health'?{appId:'meeting-transcriber',protocolVersion:3,serverVersion:'4.3.0',authMode:mode,token:mode==='lan'?'fixture-operation-token':undefined,executionTarget:'server'}:req.url==='/v1/models'?{data:[]}:{jobs:[]}));});}
const lan=upstream('lan'),bearer=upstream('bearer'),lanUrl=await listen(lan),bearerUrl=await listen(bearer),web=createWebServer({speechUrl:lanUrl}),url=await listen(web);let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1400,height:900}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(url);await page.getByText(/接続済み 4\.3\.0・LAN（キー不要）/).waitFor();await page.getByRole('button',{name:'接続設定',exact:true}).click();assert.equal(await page.getByLabel('サーバー接続キー',{exact:true}).inputValue(),'');
 await page.getByLabel('文字起こしサーバーURL',{exact:true}).fill(bearerUrl);await page.getByRole('button',{name:'この接続先へ接続',exact:true}).click();await page.getByRole('alert').filter({hasText:'Bearer認証'}).waitFor();
 await page.getByLabel('サーバー接続キー',{exact:true}).fill('fixture-browser-key');await page.getByRole('button',{name:'この接続先へ接続',exact:true}).click();await page.getByText(/接続済み 4\.3\.0・Bearer/).waitFor();assert.equal(await page.getByLabel('サーバー接続キー',{exact:true}).inputValue(),'');
 await page.getByLabel('サーバー接続キー',{exact:true}).fill('fixture-must-be-cleared');await page.getByLabel('文字起こしサーバーURL',{exact:true}).fill(lanUrl);assert.equal(await page.getByLabel('サーバー接続キー',{exact:true}).inputValue(),'');await page.getByRole('button',{name:'この接続先へ接続',exact:true}).click();await page.getByText(/接続済み 4\.3\.0・LAN（キー不要）/).waitFor();
 assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage)),[]);assert.deepEqual(await page.context().cookies(),[]);assert.deepEqual(errors,[]);
 await mkdir('runtime/connection-review',{recursive:true});await page.screenshot({path:'runtime/connection-review/lan-key-empty.png'});await writeFile('runtime/connection-review/ui-result.json',JSON.stringify({passed:true,syntheticServers:true,cases:['LAN key empty','Bearer key required','Bearer success and input cleared','URL change clears previous key','no localStorage/cookie credential'],errors},null,2));console.log('LAN/Bearer接続設定・キー消去・非保存のブラウザー試験成功');
}finally{await browser?.close();await stop(web);await stop(lan);await stop(bearer);}
