import type {Job,Segment,SpeechClient} from './speech-client';
export const isActiveJob=(job:Job|null)=>!!job&&['queued','running','uploading'].includes(job.status);
export class RecognitionResults {
 private epoch=0;private id='';private pending=-1;private rows:Segment[]=[];
 private client:Pick<SpeechClient,'request'|'segments'>;
 constructor(client:Pick<SpeechClient,'request'|'segments'>){this.client=client;}
 select(id:string){this.epoch++;this.id=id;this.rows=[];}
 async refresh(reset=false){
  const epoch=this.epoch,id=this.id;if(!id||this.pending===epoch)return null;this.pending=epoch;
  try{
   const {job}=await this.client.request(`/api/jobs/${encodeURIComponent(id)}`) as {job:Job};if(epoch!==this.epoch)return null;if(job.id!==id)throw Error('取得したジョブが一致しません。');
   const old=reset?[]:this.rows,after=old.at(-1)?.id??0;
   const updates=await this.client.segments(id,after,old.length);
   if(epoch!==this.epoch)return null;
   const byId=new Map(old.map(row=>[row.id,row]));for(const row of updates){if(!Number.isSafeInteger(row.id)||row.id<=0)throw Error('字幕IDが正しくありません。');byId.set(row.id,row);}
   this.rows=[...byId.values()].sort((a,b)=>a.id-b.id);
   return {job,segments:this.rows,updatedAt:Date.now()};
  }catch(error){if(epoch!==this.epoch)return null;throw error;}finally{if(this.pending===epoch)this.pending=-1;}
 }
}
const safe=(value:unknown)=>String(value??'unknown').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/\s+/g,'_').replace(/[. ]+$/g,'').slice(0,100)||'unknown';
export function transcriptionName(job:Job,source:string,serverUrl:string,extension='vtt'){
 let origin='server';try{const u=new URL(serverUrl);origin=['localhost','127.0.0.1','[::1]'].includes(u.hostname)?'this-PC':`server-${u.hostname}${u.port?'-'+u.port:''}`;}catch{/* Name stays generic; never copy raw URL or credentials. */}
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
