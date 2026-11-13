import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {version}=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
const folder=resolve(root,'runtime','standalone-acceptance',randomUUID(),'日本語 空白フォルダー');
await mkdir(folder,{recursive:true});
const name=`TranscriptCutter-web-v${version}.exe`,exe=join(folder,name);
await copyFile(resolve(root,'release',`v${version}`,name),exe);
const env={...process.env,PATH:join(process.env.SystemRoot,'System32')+';'+process.env.SystemRoot,TC_WEB_PORT:'0',TC_WEB_STATE_DIR:resolve(folder,'..','state'),TC_TRANSCRIPTION_TOKEN:''};
assert.equal(execFileSync(exe,['--version'],{cwd:folder,env,encoding:'utf8'}).trim(),`TranscriptCutter Web v${version}`);
const calls=[],id='a'.repeat(32);
const upstream=createServer(async(req,res)=>{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);
 calls.push({path:req.url,method:req.method,token:req.headers['x-local-token'],body:Buffer.concat(chunks).toString()});
 res.setHeader('Content-Type','application/json');
 if(req.url==='/api/health'){res.end(JSON.stringify({appId:'meeting-transcriber',protocolVersion:3,serverVersion:'fixture',authMode:'lan',token:'synthetic-operation-token',ready:true}));return;}
 if(req.headers['x-local-token']!=='synthetic-operation-token'){res.writeHead(401).end('{}');return;}
 res.end(JSON.stringify({data:[],job:{id,status:req.url.endsWith('/cancel')?'cancelled':'queued'},segments:[]}));
});
await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
const registry=await readFile('C:/develop/DevServer/local/servers.json','utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
if(new RegExp(`\\b${upstream.address().port}\\b`).test(registry)){upstream.close();throw Error('合成サーバーの割当ポートが予約済みです。再実行してください。');}
env.TC_TRANSCRIPTION_URL=`http://127.0.0.1:${upstream.address().port}`;
let child;
try{
 child=spawn(exe,['--no-open'],{cwd:folder,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let output='';const base=await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('起動タイムアウト')),15000);
  child.once('error',error=>{clearTimeout(timeout);reject(error);});
  child.once('exit',code=>{clearTimeout(timeout);reject(Error(`EXE exit ${code}: ${output}`));});
  child.stderr.on('data',chunk=>{output+=chunk;});
  child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+\//);if(match){clearTimeout(timeout);resolve(match[0]);}});
 });
 const receipt=JSON.parse(await readFile(resolve(root,'release',`v${version}`,name+'.json'),'utf8'));
 for(const [path,expected] of Object.entries(receipt.assets)){
  const response=await fetch(new URL(path,base));assert.equal(response.status,200);
  const body=Buffer.from(await response.arrayBuffer());assert.equal(createHash('sha256').update(body).digest('hex'),expected);
  if(path==='/index.html')assert.ok(body.toString().includes(`v${version}`));
 }
 assert.equal((await fetch(base+'package.json')).status,404);
 assert.equal((await fetch(base,{headers:{Origin:'http://foreign.invalid'}})).status,403);
 const headers={'X-TC-Client':'standalone-fixture-client','Content-Type':'application/json'};
 const connection=await fetch(base+'connection',{method:'POST',headers,body:JSON.stringify({url:env.TC_TRANSCRIPTION_URL,key:''})});
 assert.equal(connection.status,200);assert.ok(!(await connection.text()).includes('synthetic-operation-token'));
 assert.equal((await fetch(base+'speech/v1/models',{headers})).status,200);
 for(const [method,path,body] of [['POST','/api/jobs','synthetic audio'],['PATCH',`/api/jobs/${id}/segments`,'[{"id":1,"text":"合成編集"}]'],['POST',`/api/jobs/${id}/cancel`,'{}']]){
  const response=await fetch(base+'speech'+path,{method,headers,body});assert.equal(response.status,200);
  assert.equal(calls.at(-1).method,method);assert.equal(calls.at(-1).body,body);assert.equal(calls.at(-1).token,'synthetic-operation-token');
 }
 assert.deepEqual(await readdir(folder),[name]);
 const report={version,exe,sha256:receipt.sha256,bytes:receipt.bytes,isolatedFiles:[name],path:env.PATH,embeddedAssetsVerified:Object.keys(receipt.assets),syntheticOperations:['connect','models','upload','edit','cancel'],realTranscription:false,result:'passed'};
 await writeFile(resolve(root,'runtime','standalone-acceptance.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}finally{
 if(child&&child.exitCode===null){const ended=new Promise(resolve=>child.once('exit',resolve));child.kill();await ended;}
 upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));
}
