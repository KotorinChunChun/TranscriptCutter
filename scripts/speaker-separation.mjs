import {createReadStream,existsSync} from 'node:fs';
import {mkdir,readFile,writeFile,readdir,rename,rm,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';

const repo=fileURLToPath(new URL('../',import.meta.url));
const idPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function separationReferences(value){
 if(!Array.isArray(value)||value.length>3)throw Error('参照する話者は3人までです。');
 return value.map(r=>{if(!r||typeof r.name!=='string'||!r.name.trim()||r.name.length>100||!Number.isSafeInteger(r.start)||!Number.isSafeInteger(r.end)||r.start<0||r.end-r.start<1000||r.end>7200000)throw Error('話者の参照区間が不正です。');return {name:r.name.trim(),start:r.start,end:r.end};});
}
export function createSpeakerSeparation({python=process.env.TC_SEPARATION_PYTHON??resolve(repo,'runtime/source-separation/python/Scripts/python.exe'),models=process.env.TC_SEPARATION_MODELS??resolve(repo,'runtime/source-separation/models'),workDir=resolve(repo,'runtime/source-separation/jobs'),worker=resolve(repo,'scripts/audio-separation/worker.py')}={}){
 const jobs=new Map();let child=null,uploading=false,persist=Promise.resolve();
 const ready=()=>existsSync(python)&&existsSync(resolve(models,'models.lock.json'))&&existsSync(worker);
 const save=j=>{const text=JSON.stringify(j),folder=resolve(workDir,j.id);persist=persist.catch(()=>{}).then(async()=>{await writeFile(resolve(folder,'job.tmp'),text);await rename(resolve(folder,'job.tmp'),resolve(folder,'job.json'));});return persist;};
 const loaded=(async()=>{await mkdir(workDir,{recursive:true});for(const name of await readdir(workDir)){if(!idPattern.test(name))continue;try{const j=JSON.parse(await readFile(resolve(workDir,name,'job.json'),'utf8'));if(j.id===name&&j.status==='complete'&&/^[a-f0-9]{64}$/.test(j.sha256)){await stat(resolve(workDir,name,'result.json'));jobs.set(name,j);}}catch{}}})();
 const result=async j=>({...j,...(j.status==='complete'?{result:JSON.parse(await readFile(resolve(workDir,j.id,'result.json'),'utf8'))}:{})});
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 async function handle(req,res){
  const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/separation/'))return false;
  try{
   await loaded;
   if(req.headers.origin&&req.headers.origin!==`${req.socket.encrypted?'https':'http'}://${req.headers.host}`){json(res,403,{error:'接続元を確認してください。'});return true;}
   if(req.method==='POST'&&req.headers['x-tc-separation']!=='1'){json(res,403,{error:'操作を確認してください。'});return true;}
   if(url.pathname==='/separation/status'&&req.method==='GET'){json(res,200,{ready:ready(),busy:!!child||uploading,model:'SepFormer Libri3Mix + ECAPA',maxSpeakers:3});return true;}
   if(url.pathname==='/separation/jobs'&&req.method==='POST'){
    if(!ready()){json(res,503,{error:'このWebサーバーでは音源分離モデルが未導入です。'});return true;}
    if(child||uploading){json(res,409,{error:'別の音源分離が処理中です。完了後にお試しください。'});return true;}
    const length=Number(req.headers['content-length']);if(length>512*1024*1024)throw Error('メディアは512MiBまでです。');
    let refs;try{refs=separationReferences(JSON.parse(Buffer.from(String(req.headers['x-tc-references']??'W10='),'base64').toString('utf8')));}catch{throw Error('話者の参照区間が不正です。');}
    const id=randomUUID(),folder=resolve(workDir,id);uploading=true;
    try{
     await mkdir(folder);
     const {open}=await import('node:fs/promises');const file=await open(resolve(folder,'input.media'),'wx'),hash=createHash('sha256');let bytes=0;
     try{for await(const chunk of req){bytes+=chunk.length;if(bytes>512*1024*1024)throw Error('メディアは512MiBまでです。');hash.update(chunk);await file.write(chunk);}if(!bytes)throw Error('メディアが空です。');}finally{await file.close();}
     const sha256=hash.digest('hex');const cached=[...jobs.values()].find(j=>j.status==='complete'&&j.sha256===sha256&&j.bytes===bytes);
     if(cached){await rm(folder,{recursive:true,force:true});json(res,200,{...await result(cached),cached:true});return true;}
     if(jobs.size>=64)throw Error('音源分離の保存数が上限に達しました。管理者へお問い合わせください。');
     const j={id,status:'processing',phase:'starting',progress:0,sha256,bytes,createdAt:new Date().toISOString()};jobs.set(id,j);await save(j);
     await writeFile(resolve(folder,'config.json'),JSON.stringify({input:resolve(folder,'input.media'),output:folder,models,references:refs}));
     const env={...process.env,HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',PYTHONUNBUFFERED:'1'};
     const proc=spawn(python,['-u',worker,resolve(folder,'config.json')],{windowsHide:true,stdio:['ignore','pipe','pipe'],env});child={proc,job:j};let pending='',errors='',finished=false;
     proc.stdout.setEncoding('utf8');proc.stdout.on('data',data=>{pending+=data;let edge;while((edge=pending.indexOf('\n'))>=0){const line=pending.slice(0,edge);pending=pending.slice(edge+1);try{const p=JSON.parse(line);j.phase=p.phase;j.progress=Math.max(0,Math.min(1,Number(p.progress)||0));j.processedMs=p.processedMs;void save(j).catch(()=>{});}catch{}}});
     proc.stderr.setEncoding('utf8');proc.stderr.on('data',data=>{errors=(errors+data).slice(-16000);});
     const finish=async(code)=>{if(finished)return;finished=true;if(j.status==='cancelled'){if(child?.proc===proc)child=null;return;}try{if(code!==0)throw Error();await readFile(resolve(folder,'result.json'));j.status='complete';j.progress=1;}catch{j.status='error';j.error='音源分離に失敗しました。音声とモデルの導入状態を確認してください。';}await writeFile(resolve(folder,'worker.log'),errors);await save(j);if(child?.proc===proc)child=null;};
     proc.once('error',()=>{void finish(-1).catch(()=>{});});proc.once('close',code=>{void finish(code).catch(()=>{if(child?.proc===proc)child=null;});});json(res,202,j);return true;
    }catch(error){if(!jobs.has(id))await rm(folder,{recursive:true,force:true});throw error;}finally{uploading=false;}
   }
   const match=/^\/separation\/jobs\/([a-f0-9-]{36})(?:\/(cancel|tracks\/([123])\.wav))?$/.exec(url.pathname);
   if(match&&idPattern.test(match[1])){
    const j=jobs.get(match[1]);if(!j){json(res,404,{error:'分離結果が見つかりません。再度作成してください。'});return true;}
    if(!match[2]&&req.method==='GET'){json(res,200,await result(j));return true;}
    if(match[2]==='cancel'&&req.method==='POST'){
     if(child?.job===j){j.status='cancelled';const proc=child.proc;if(process.platform==='win32')spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else proc.kill();await save(j);}json(res,200,j);return true;
    }
    if(match[3]&&req.method==='GET'&&j.status==='complete'){
     const path=resolve(workDir,j.id,`voice-${match[3]}.wav`),info=await stat(path);let start=0,end=info.size-1;
     if(req.headers.range){const r=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!r){res.writeHead(416).end();return true;}start=Number(r[1]);end=r[2]?Math.min(Number(r[2]),end):end;if(start>end){res.writeHead(416).end();return true;}res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${info.size}`);}
     res.setHeader('Content-Type','audio/wav');res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Length',end-start+1);createReadStream(path,{start,end}).pipe(res);return true;
    }
   }
   json(res,404,{error:'音源分離の操作が見つかりません。'});
  }catch(error){if(!res.headersSent)json(res,400,{error:error.message??'音源分離を開始できませんでした。'});else res.destroy();}return true;
 }
 return {handle,close(){if(child){const {proc,job}=child;job.status='cancelled';void save(job).catch(()=>{});if(process.platform==='win32'&&proc.pid)spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else proc.kill();}}};
}
