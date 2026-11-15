import type {Job,Segment,SpeechClient} from './speech-client';
import {resultGeneration} from './speech-client';
export const isActiveJob=(job:Job|null)=>!!job&&['queued','running','uploading'].includes(job.status);
const statusLabels:Record<string,string>={uploading:'送信中',queued:'待機中',running:'認識中',complete:'完了',error:'エラー',cancelled:'中止',interrupted:'中断'};
const runningPhases:Record<string,string>={preparing:'音声・モデルを準備中',converting:'音声を変換中',loading:'モデルを準備中',loading_model:'モデルを準備中',downloading:'モデルを取得中',diarizing:'話者を識別中',transcribing:'字幕を認識中'};
/** Status determines lifecycle; new server phases never turn an active job into a failure. */
export function recognitionLabels(job:Job|null){
 if(!job)return {statusLabel:'未実行',phaseLabel:'未実行',waitingReason:''};
 const statusLabel=Object.hasOwn(statusLabels,job.status)?statusLabels[job.status]:'状態不明';
 if(job.status==='queued'){
  const reason=job.metadata?.waitingReason;
  return {statusLabel,phaseLabel:job.phase==='recovered'?'再起動後の再実行待ち':job.phase==='waiting_resources'?'資源待ち':statusLabel,waitingReason:typeof reason==='string'?reason.trim():''};
 }
 const phase=String(job.phase);
 return {statusLabel,phaseLabel:job.status==='running'?(Object.hasOwn(runningPhases,phase)?runningPhases[phase]:'処理中'):statusLabel,waitingReason:''};
}
export class RecognitionResults {
 private epoch=0;private id='';private pending=-1;private rows:Segment[]=[];private generation:number|undefined;
 private client:Pick<SpeechClient,'request'|'segments'>&Partial<Pick<SpeechClient,'segmentSnapshot'>>;
 constructor(client:Pick<SpeechClient,'request'|'segments'>&Partial<Pick<SpeechClient,'segmentSnapshot'>>){this.client=client;}
 select(id:string){this.epoch++;this.id=id;this.rows=[];this.generation=undefined;}
 async refresh(reset=false){
  const epoch=this.epoch,id=this.id;if(!id||this.pending===epoch)return null;this.pending=epoch;
  try{
   for(let attempt=0;attempt<3;attempt++){
    let {job}=await this.client.request(`/api/jobs/${encodeURIComponent(id)}`) as {job:Job};if(epoch!==this.epoch)return null;if(job.id!==id)throw Error('取得したジョブが一致しません。');
    const observed=resultGeneration(job.metadata?.resultGeneration),old=reset||observed!==this.generation?[]:this.rows,after=old.at(-1)?.id??0;
    const snapshot=this.client.segmentSnapshot?await this.client.segmentSnapshot(id,after,old.length,observed):{segments:await this.client.segments(id,after,old.length),resultGeneration:observed};
    if(epoch!==this.epoch)return null;
    if(snapshot.resultGeneration!==undefined){
     const latest=await this.client.request(`/api/jobs/${encodeURIComponent(id)}`) as {job:Job};if(epoch!==this.epoch)return null;if(latest.job.id!==id)throw Error('取得したジョブが一致しません。');
     if(resultGeneration(latest.job.metadata?.resultGeneration)!==snapshot.resultGeneration){reset=true;continue;}job=latest.job;
    }
    const retained=snapshot.resultGeneration===this.generation&&!reset?old:[];
    const byId=new Map(retained.map(row=>[row.id,row]));for(const row of snapshot.segments){if(!Number.isSafeInteger(row.id)||row.id<=0)throw Error('字幕IDが正しくありません。');byId.set(row.id,row);}
    // A final job read can observe completion after more subtitles were appended.
    if(snapshot.resultGeneration!==undefined&&Number.isSafeInteger(job.segmentCount)&&Number(job.segmentCount)>byId.size){reset=true;continue;}
    this.rows=[...byId.values()].sort((a,b)=>a.id-b.id);this.generation=snapshot.resultGeneration;
    return {job,segments:this.rows,updatedAt:Date.now()};
   }
   throw Error('字幕が再生成中です。次の更新で再確認します。');
  }catch(error){if(epoch!==this.epoch)return null;throw error;}finally{if(this.pending===epoch)this.pending=-1;}
 }
}
const safe=(value:unknown)=>String(value??'unknown').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/\s+/g,'_').replace(/[. ]+$/g,'').slice(0,100)||'unknown';
export function transcriptionName(job:Job,source:string,serverUrl:string,extension='vtt'){
 let origin='server';try{const u=new URL(serverUrl);origin=['localhost','127.0.0.1','[::1]'].includes(u.hostname)?'this-PC':`server-${u.hostname}${u.port?'-'+u.port:''}`;}catch{/* Name stays generic; never copy raw URL or credentials. */}
 if(job.engine==='browser-whisper'||job.engine==='browser-haas')origin='browser-this-PC';
 return `${safe(source.replace(/\.[^.]+$/,''))}__${safe(origin)}__${safe(job.engine??job.metadata?.engineId)}__${safe(job.modelId??job.metadata?.modelId)}__${job.status==='complete'?'complete':'partial'}__${safe(job.id.slice(0,8))}.${extension}`;
}
export function recognitionProgress(job:Job|null){
 if(!job)return {from:0,to:0,done:0,fraction:0};
 const from=Number(job.rangeStart??0),to=Number(job.rangeEnd??job.duration??from),done=Math.max(from,Math.min(to,Number(job.processedUntil??from)));
 return {from,to,done,fraction:to>from?Math.max(0,Math.min(1,(done-from)/(to-from))):0};
}
export function recognitionElapsed(job:Job|null,now:number):{seconds:number|null;source:'server'|'timestamps'|'live'|'unknown'}{
 if(!job)return {seconds:null,source:'unknown'};const m=job.metadata??{},start=Date.parse(String(m.startedAt??m.queuedAt??job.createdAt??''));
 if(!isActiveJob(job)&&typeof m.runSeconds==='number'&&Number.isFinite(m.runSeconds)&&m.runSeconds>=0)return {seconds:m.runSeconds,source:'server'};
 const end=isActiveJob(job)?now:Date.parse(String(m.finishedAt??m.completedAt??''));
 return Number.isFinite(start)&&Number.isFinite(end)&&end>=start?{seconds:(end-start)/1000,source:isActiveJob(job)?'live':'timestamps'}:{seconds:null,source:'unknown'};
}
