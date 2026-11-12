import type {Job} from './speech-client';
const terminal=new Set(['complete','cancelled','error','interrupted']);
export function deletableHistory(job:Job,supported:boolean){return supported&&/^[a-f0-9]{32}$/i.test(job.id)&&job.clientId==='transcript-cutter'&&job.workload==='file'&&terminal.has(job.status);}
export function historyPageInfo(value:{jobs:Job[];total?:number;nextOffset?:number|null},page:number,limit=50){
 if(!Array.isArray(value.jobs)||value.jobs.some(job=>!job||typeof job.id!=='string'||typeof job.status!=='string'))throw Error('履歴の応答を確認してください。');
 const total=typeof value.total==='number'&&Number.isSafeInteger(value.total)&&value.total>=0?value.total:page*limit+value.jobs.length;
 return {jobs:value.jobs,total,hasNext:value.nextOffset!==undefined?value.nextOffset!==null:(page+1)*limit<total};
}
