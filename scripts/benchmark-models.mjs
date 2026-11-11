import {createReadStream} from 'node:fs';
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {resolve,basename,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {connectSpeech} from './speech-connection.mjs';
import {makeExport} from '../web/transcript-utils.mjs';
const terminal=new Set(['complete','error','cancelled','interrupted']);
export const safeName=value=>String(value??'unknown').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/\s+/g,'_').replace(/[. ]+$/g,'').slice(0,100)||'unknown';
export const nextAction=row=>terminal.has(row.status)?'skip':row.jobId?'resume':row.status==='not_started'?'submit':'uncertain';
export function summarize(job,segments,wallSeconds){
 const m=job.metadata??{},duration=Number(job.rangeEnd??job.duration)-Number(job.rangeStart??0);
 const start=Date.parse(m.startedAt??''),end=Date.parse(m.finishedAt??m.completedAt??''),derivedRunSeconds=Number.isFinite(start)&&Number.isFinite(end)&&end>=start?(end-start)/1000:null,elapsed=Number.isFinite(m.runSeconds)?m.runSeconds:derivedRunSeconds;
 return {status:job.status,phase:job.phase,jobId:job.id,segmentCount:segments.length,characters:segments.reduce((n,s)=>n+String(s.text??'').length,0),processedUntil:job.processedUntil,durationSeconds:duration,runSeconds:m.runSeconds??null,derivedRunSeconds,timingSource:Number.isFinite(m.runSeconds)?'server':derivedRunSeconds!==null?'timestamps':'unavailable',queueSeconds:m.queueSeconds??null,resourceWaitSeconds:m.resourceWaitSeconds??null,modelLoadSeconds:m.modelLoadSeconds??null,modelReused:m.modelReused??null,actualDevice:m.actualDevice??m.executionDevice??null,wallSeconds,realTimeFactor:job.status==='complete'&&duration>0&&elapsed!==null?elapsed/duration:null,error:job.error??null};
}
export function report(run){
 const cell=v=>v===null||v===undefined?'—':String(v).replace(/\|/g,'／').replace(/[\r\n]+/g,' '),seconds=v=>typeof v==='number'?v.toFixed(3):'—';
 return `# 文字起こしモデル比較：${run.label}\n\n更新：${new Date().toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})} JST\n\nモデル比較：終端 ${run.results.filter(r=>terminal.has(r.status)).length}/${run.results.length}。${run.pauseReason??(run.finishedAt?'記録完了':'実行中')}\n\n- 実行機（別サーバーのCPU/RAMは未取得なら未取得と表示）：${run.machine.hostname} / ${run.machine.cpu} / RAM ${run.machine.memoryBytes>0?(run.machine.memoryBytes/1024**3).toFixed(1)+' GiB':'未取得'} / ${run.machine.os}\n- サーバー：${run.serverUrl} / v${run.serverVersion} / protocol ${run.protocolVersion}\n- 動画：${run.video.name} / ${run.video.bytes} bytes / SHA256 ${run.video.sha256}\n- 条件：全区間、処理方式auto、話者識別なし、file枠で逐次実行、各モデル1回。外部APIは実行しない。\n- 初回モデル取得・モデルロード・キャッシュの影響を含む。デバイス欄はactualDeviceを優先し、未提供ならexecutionDevice（要求方式）を表示する。autoはGPU実動作の確認を意味しない。純粋な推論速度の公平な順位ではない。※はサーバーがrunSecondsを返さない場合に開始/完了時刻の差で求めた値で、サーバー実測値と区別する。runはサーバーの実行開始後、wallは送信開始から結果回収まで、RTFはrun÷認識範囲秒（完了時のみ）。\n- 失敗VTTは確定済み字幕だけの部分結果。元動画全体の字幕や認識精度の合格を意味しない。正解字幕との精度評価は未実施。\n- 実行区分：${run.executionScope==='remote-server'?'別サーバー（接続先のハードウェア情報は未検証）':'このPC'}。別の機械ではlabel・出力先を分け、同じ動画ハッシュ/条件を使用する。\n\n| エンジン/モデル | 状態 | デバイス | run秒 | wall秒 | 待機秒 | ロード秒 | RTF | 字幕件数 | 到達秒 | VTT | エラー |\n|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|\n`+run.results.map(r=>`| ${cell(r.model)} | ${cell(r.status)} | ${cell(r.actualDevice)} | ${seconds(r.runSeconds??r.derivedRunSeconds)}${r.timingSource==='timestamps'?'※':''} | ${seconds(r.wallSeconds)} | ${seconds(r.queueSeconds)} | ${seconds(r.modelLoadSeconds)} | ${seconds(r.realTimeFactor)} | ${r.segmentCount??'—'} | ${seconds(r.processedUntil)} | ${r.vtt?`[${r.status==='complete'?'完了':'部分'}](${r.vtt})`:'—'} | ${cell(r.error)} |`).join('\n')+'\n\n詳細なジョブ情報・元字幕は各JSONとrun.jsonを参照。別PCの数字をこの表へ混ぜず、実行機ごとの記録を保持する。\n';
}
async function main(){
 const args=process.argv.slice(2),get=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};
 const video=get('video'),label=get('label');if(!video||!label)throw Error('--video と --label を明示してください。');
 const target=get('server')??'http://127.0.0.1:8769/',connection=await connectSpeech(target,process.env.TC_BENCHMARK_KEY??'');
 const api=async(path,options={})=>{const response=await fetch(new URL(path,connection.target),{redirect:'error',...options,headers:{...connection.headers,...options.headers}});const value=await response.json();if(!response.ok)throw Error(value.error?.message??value.error??`HTTP ${response.status}`);return value;};
 const selected=get('models')?.split(','),models=(await api('/v1/models')).data.filter(m=>['whisper','haas','qwen','reazon','parakeet'].includes(m.x_meeting?.engineId)&&(!selected||selected.includes(m.id)));
 if(!models.length||selected?.some(id=>!models.some(m=>m.id===id)))throw Error('実行モデルをサーバーの利用可能なモデルから指定してください。');
 if(selected)models.sort((a,b)=>selected.indexOf(a.id)-selected.indexOf(b.id));
 const file=resolve(video),info=await stat(file),hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);const sha256=hash.digest('hex');
 const clientMachine={hostname:os.hostname(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem(),os:`${os.platform()} ${os.release()} ${os.arch()}`},local=['127.0.0.1','localhost','[::1]'].includes(connection.target.hostname);
 const out=resolve(get('out')??join('dev/benchmarks',safeName(label)+'-'+new Date().toISOString().replace(/[:.]/g,'-')));await mkdir(out,{recursive:true});
 let run;try{run=JSON.parse(await readFile(join(out,'run.json'),'utf8'));if(run.video.sha256!==sha256||run.label!==label||run.serverUrl!==connection.target.href||run.serverVersion!==connection.health.serverVersion)throw Error('再開先の実行条件が異なります。');}catch(e){if(e.code!=='ENOENT')throw e;run={schemaVersion:1,label,startedAt:new Date().toISOString(),serverUrl:connection.target.href,serverVersion:connection.health.serverVersion,protocolVersion:connection.health.protocolVersion,clientMachine,executionScope:local?'this-PC':'remote-server',machine:local?clientMachine:{hostname:connection.target.hostname,cpu:'未取得（接続先サーバー）',memoryBytes:null,os:'未取得',hardwareVerified:false},video:{name:basename(file),bytes:info.size,sha256},conditions:{start:0,end:null,device:'auto',diarize:false},results:models.map(m=>({model:m.id,status:'not_started'}))};}
 if(run.results.length!==models.length||run.results.some(r=>!models.some(m=>m.id===r.model)))throw Error('再開先のモデル一覧が異なります。出力先を分けてください。');
 const save=async()=>{await writeFile(join(out,'run.json'),JSON.stringify(run,null,2));await writeFile(join(out,'report.md'),report(run));};
 const segments=async id=>{let after=0;const rows=[];for(let i=0;i<10000;i++){const value=await api(`/api/jobs/${id}/segments?after=${after}&limit=1000`);rows.push(...value.segments);if(!value.segments.length||rows.length>=value.total)return rows;const next=Number(value.next??value.segments.at(-1).id);if(next<=after)throw Error('字幕ページングが進みません。');after=next;}throw Error('字幕の取得上限です。');};
 await save();console.log('比較記録: '+out);
 // Recover the user's failed result without editing or resubmitting that job.
 if(get('recover')&&!run.recoveredJob){const id=get('recover');if(!/^[a-f0-9]{32}$/.test(id))throw Error('回収するジョブIDを確認してください。');const job=(await api(`/api/jobs/${id}`)).job;if(job.fileName!==basename(file))throw Error('回収元の動画名が異なります。');const rows=await segments(id);const name=`${safeName(label)}__existing-${id.slice(0,8)}__${safeName(job.engine)}__${safeName(job.modelId)}__partial`;await writeFile(join(out,name+'.json'),JSON.stringify({job,segments:rows},null,2));if(rows.length)await writeFile(join(out,name+'.vtt'),makeExport({format:'vtt',segments:rows}).text);run.recoveredJob={jobId:id,status:job.status,segmentCount:rows.length,file:name+'.vtt'};await save();}
 for(const model of models){
  let row=run.results.find(r=>r.model===model.id);if(!row){row={model:model.id,status:'not_started'};run.results.push(row);}const action=nextAction(row);if(action==='skip')continue;if(action==='uncertain'){row.status='upload_uncertain';row.error='前回の送信の受付結果が不明です。履歴で確認するまで自動再送しません。';await save();throw Error(row.error);}if(row.jobId&&!/^[a-f0-9]{32}$/.test(row.jobId))throw Error('記録のジョブIDを確認してください。');
  let job;if(row.jobId){job=(await api(`/api/jobs/${row.jobId}`)).job;}else{
   try{await stat(join(out,'PAUSE_NEW_JOBS'));run.pauseReason='新規投入の保留指示。既存の処理は中止していません。';run.pausedAt=new Date().toISOString();await save();console.log('新規ジョブ投入を保留: '+out);return;}catch(error){if(error.code!=='ENOENT')throw error;}
   row.uploadStartedAt=new Date().toISOString();row.status='uploading';await save();console.log(model.id+' 送信開始');
   const q=new URLSearchParams({name:basename(file),engine:model.x_meeting.engineId,model:model.x_meeting.modelId,device:'auto',diarize:'false',clientId:'transcript-cutter-benchmark',workload:'file',start:'0'});
   try{job=(await api('/api/jobs?'+q,{method:'POST',headers:{'Content-Type':'application/octet-stream','Content-Length':String(info.size)},body:createReadStream(file),duplex:'half'})).job;if(!/^[a-f0-9]{32}$/.test(job?.id))throw Error('受付ジョブIDが不正です。');row.jobId=job.id;row.status=job.status;await save();}
   catch(e){row.status='upload_uncertain';row.error=String(e);await save();throw Error('受付結果が不明のため自動再送せず停止しました。履歴で確認してください。');}
  }
  let last='';while(!terminal.has(job.status)){
   Object.assign(row,{status:job.status,phase:job.phase,segmentCount:job.segmentCount,processedUntil:job.processedUntil});const progress=`${job.status}/${job.phase} ${Number(job.processedUntil??0).toFixed(1)}秒 字幕${job.segmentCount??0}件`;if(last!==progress){console.log(model.id+' '+progress);last=progress;await save();}
   await new Promise(r=>setTimeout(r,5000));job=(await api(`/api/jobs/${job.id}`)).job;
  }
  const rows=await segments(job.id),wall=(Date.now()-Date.parse(row.uploadStartedAt))/1000;Object.assign(row,summarize(job,rows,wall));
  const name=`${safeName(basename(file).replace(/\.[^.]+$/,''))}__${safeName(label)}__${safeName(model.x_meeting.engineId)}__${safeName(model.x_meeting.modelId)}__${job.status==='complete'?'complete':'partial'}__${job.id.slice(0,8)}`;
  row.details=name+'.json';await writeFile(join(out,row.details),JSON.stringify({job,segments:rows},null,2));if(rows.length){try{row.vtt=name+'.vtt';await writeFile(join(out,row.vtt),makeExport({format:'vtt',segments:rows}).text);}catch(e){delete row.vtt;row.artifactError=String(e);row.error=[row.error,row.artifactError].filter(Boolean).join(' / ');}}
  await save();console.log(model.id+' 終了 '+job.status+' / '+(row.runSeconds??row.derivedRunSeconds??'計測値なし')+'秒'+(row.timingSource==='timestamps'?'（開始/完了時刻差）':'')+' / 字幕'+rows.length+'件');
 }
 run.finishedAt=new Date().toISOString();await save();console.log('全モデルの記録完了: '+out);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
