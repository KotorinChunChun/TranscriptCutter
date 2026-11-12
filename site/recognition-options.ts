import type {Job,Model} from './speech-client';
export type BoundaryMode='edge'|'custom';
export function parseClock(value:string):number{
 const match=/^(\d{2,}):([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(value.trim());
 if(!match)throw Error('時刻はhh:mm:ss.sssで入力してください。');
 const seconds=Number(match[1])*3600+Number(match[2])*60+Number(match[3])+Number(match[4])/1000;
 if(!Number.isFinite(seconds)||seconds>Number.MAX_SAFE_INTEGER/1000)throw Error('時刻が大きすぎます。');
 return seconds;
}
export function recognitionRange(startMode:BoundaryMode,start:string,endMode:BoundaryMode,end:string){
 const from=startMode==='edge'?0:parseClock(start),to=endMode==='edge'?undefined:parseClock(end);
 if(to!==undefined&&to<=from)throw Error('終了時刻は開始時刻より後にしてください。');
 return {from,to};
}
export function supportedModel(m:Model){
 const x=m.x_meeting;if(!x||!['whisper','haas','qwen','reazon','parakeet','nemotron-asr'].includes(x.engineId)||x.task!==undefined&&x.task!=='transcription')return false;
 if(!Array.isArray(x.processingMethods)||!x.processingMethods.length)return false;
 if(x.supported===false||x.supportStatus==='unsupported')return false;
 if(x.supported===true&&x.runtimeInstallable===true)return true;
 return !(x.installable===false&&!['installed','ready'].includes(x.availability??''))&&![x.availability,x.managementState,x.runtimeStatus].some(value=>['unavailable','unsupported','missing_runtime','runtime_error','unconfigured','not_supported'].includes(String(value)));
}
export function effectiveDiarization(preference:boolean,model:Model|undefined){return preference&&model?.x_meeting.diarization===true;}
export function finishEstimate(job:Job|null,now:number):{remainingSeconds:number;finishAt:number}|null{
 if(!job||job.status!=='running'||!['transcribing','recognizing'].includes(String(job.phase)))return null;
 const start=Date.parse(String(job.metadata?.startedAt??'')),from=Number(job.rangeStart??0),to=Number(job.rangeEnd??job.duration),done=Number(job.processedUntil),elapsed=(now-start)/1000;
 if(![start,from,to,done,elapsed].every(Number.isFinite)||elapsed<3||to<=from||done<=from||done>=to)return null;
 const fraction=(done-from)/(to-from);if(fraction<=0||fraction>=1)return null;
 const remainingSeconds=elapsed*(1-fraction)/fraction;
 if(!Number.isFinite(remainingSeconds)||remainingSeconds<0)return null;
 return {remainingSeconds,finishAt:now+remainingSeconds*1000};
}
