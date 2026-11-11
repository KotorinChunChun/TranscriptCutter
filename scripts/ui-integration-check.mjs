import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve('dist');
const registry=await readFile('C:/develop/DevServer/local/servers.json','utf8');
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!path.startsWith(root+sep))throw Error();const actual=extname(path)?path:resolve(path,'index.html');const body=await readFile(actual);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css'})[extname(actual)]??'application/octet-stream');res.end(body);}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
if(new RegExp(`\\b${port}\\b`).test(registry)){server.close();throw Error('割当ポートが台帳にあります。再実行してください。');}
let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1400,height:960}});
 page.setDefaultTimeout(6000);const errors=[];page.on('pageerror',e=>{errors.push(String(e));console.log(String(e));});
 await page.addInitScript(()=>{if(window.parent!==window)return;
  const vtt='WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n<v 話者A>えっと、統合試験です。\n\n00:00:02.000 --> 00:00:04.000\n<v 話者B>次の発言です。\n';
  window.__saved=[];window.__calls=[];
  window.__TAURI__={event:{listen:async()=>()=>{}},core:{convertFileSrc:p=>'about:blank',invoke:async(cmd,args={})=>{
   window.__calls.push({cmd,args});
   if(cmd==='bootstrap')return {home:'C:/fixtures',projects:[],ffmpeg:'ffmpeg',ffprobe:'ffprobe'};
   if(cmd==='connect_server')return {models:[{id:'whisper/tiny',x_meeting:{engineId:'whisper',engineLabel:'Whisper',label:'Tiny',modelId:'tiny',processingMethods:[{id:'cpu',label:'CPU'}]}}]};
   if(cmd==='browse')return {path:args.path||'C:/fixtures',parent:'',entries:[{name:'a.vtt',path:'C:/fixtures/a.vtt',directory:false},{name:'b.vtt',path:'C:/fixtures/b.vtt',directory:false},{name:'saved.vtt-edit.json',path:'C:/fixtures/saved.vtt-edit.json',directory:false},{name:'video.mp4',path:'C:/fixtures/video.mp4',directory:false}]};
   if(cmd==='read_subtitle')return {name:args.path.split('/').at(-1),text:args.path.endsWith('.json')?window.parent.__saved.at(-1).text:vtt};
   if(cmd==='inspect_dialogue_media'||cmd==='open_media')return {path:args.path,duration:6,audio:true,width:640,height:360,bytes:100};
   if(cmd==='transcribe'||cmd==='job_status')return {job:{id:'12345678901234567890123456789012',status:'complete'}};
   if(cmd==='get_segments')return {segments:[{id:1,start:0,end:4,speaker:'話者A',text:'工程1からの引継ぎ試験。'}],total:1};
   if(cmd==='export_text'){window.parent.__saved.push(args);return args.dir+'/'+args.name+'.'+args.extension;}
   if(cmd==='cut_status')return {running:false,progress:100,output:'C:/fixtures/edited.mp4'};
   return {};
  }}};
 });
 await page.goto(`http://127.0.0.1:${port}/index.html`);
 const frame=page.frameLocator('#dialogue');await page.getByRole('button',{name:'工程2 VTT統合・編集・カット',exact:true}).click();
 await frame.getByRole('button',{name:'ファイルを開く',exact:true}).click();await frame.getByRole('button',{name:'a.vtt',exact:true}).click();await frame.getByRole('button',{name:'選択を確定',exact:true}).click();
 await frame.getByText('統合試験です。',{exact:false}).first().waitFor();
 await page.getByRole('button',{name:'工程1 文字起こし',exact:true}).click();
 await page.getByRole('button',{name:'動画を開く',exact:true}).click();await page.locator('#entries button').filter({hasText:'video.mp4'}).click();
 await page.getByRole('button',{name:'文字起こし開始',exact:true}).click();
 await page.getByRole('button',{name:'結果を工程2へ追加',exact:true}).click();
 await frame.getByRole('button',{name:'会話編集に反映',exact:true}).waitFor();
 await frame.getByRole('button',{name:'会話編集に反映',exact:true}).click();
 await frame.getByRole('button',{name:'保存・書き出し',exact:true}).click();await frame.getByRole('button',{name:'編集プロジェクトを保存',exact:true}).click();
 await frame.getByRole('button',{name:'保存先を選んで保存',exact:true}).click();await frame.getByRole('button',{name:'選択を確定',exact:true}).click();await frame.getByRole('button',{name:'保存',exact:true}).click();
 await frame.getByText('保存しました:',{exact:false}).waitFor();
 const saved=await page.evaluate(()=>window.__saved);assert.equal(saved.length,1);const project=JSON.parse(saved[0].text);assert.ok(project.comparison);assert.equal(project.comparison.sources.length,2);
 await frame.getByRole('button',{name:'閉じる',exact:true}).click();
 // Native export consumes the editor's plan in original seconds, including tail removal.
 await frame.getByRole('button',{name:'保存・書き出し',exact:true}).click();await frame.getByRole('button',{name:'動画・音声を書き出す',exact:true}).click();
 await frame.getByRole('button',{name:'保存先を選択',exact:true}).click();await frame.getByRole('button',{name:'選択を確定',exact:true}).click();await frame.getByRole('button',{name:'書き出す',exact:true}).click();await frame.getByText('保存しました。',{exact:true}).waitFor();
 const calls=await page.evaluate(()=>window.__calls);const cut=calls.find(c=>c.cmd==='dialogue_cut');assert.deepEqual(cut.args.ranges,[{start:0,end:4}]);
 await frame.getByRole('button',{name:'閉じる',exact:true}).click();
 await frame.getByRole('button',{name:'ファイルを開く',exact:true}).click();await frame.getByRole('button',{name:'saved.vtt-edit.json',exact:true}).click();await frame.getByRole('button',{name:'選択を確定',exact:true}).click();await frame.getByRole('button',{name:'続ける',exact:true}).click();
 await frame.getByRole('button',{name:'VTTを比較',exact:true}).click();await frame.getByRole('button',{name:'会話編集に反映',exact:true}).waitFor();
 await frame.getByRole('button',{name:'会話を編集',exact:true}).click();
 const smallFonts=await frame.locator('button,input,select,textarea,p,span').evaluateAll(elements=>elements.filter(e=>e.getBoundingClientRect().width&&parseFloat(getComputedStyle(e).fontSize)<16).map(e=>e.className));assert.deepEqual(smallFonts,[]);
 await mkdir('runtime/ui',{recursive:true});await page.screenshot({path:'runtime/ui/integrated-export.png'});
 assert.deepEqual(errors,[]);await writeFile('runtime/ui/result.json',JSON.stringify({passed:true,mockedBackend:true,savedComparisonSources:2,cut:cut.args,errors},null,2));
 console.log('工程2単独読込 → 工程1引継ぎ → 比較採用 → プロジェクト保存 → 動画出力接続: 成功');
}finally{await browser?.close();await new Promise(r=>server.close(r));}





