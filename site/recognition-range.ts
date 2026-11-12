import {parseClock} from './recognition-options';
import {formatTime} from './src/lib/vtt';
export type StartMode='edge'|'custom'|'before60'|'before300';
export type EndMode='edge'|'custom'|'after60'|'after300';
export type RangeSelection={startMode:StartMode;endMode:EndMode;start:string;end:string};
export const relativeStart=(mode:StartMode)=>mode==='before60'||mode==='before300';
export const relativeEnd=(mode:EndMode)=>mode==='after60'||mode==='after300';
export const rangeClock=(seconds:number,end=false)=>formatTime(end?Math.ceil(seconds*1000):Math.round(seconds*1000),true);
export const initialRange=(duration?:number|null):RangeSelection=>({startMode:'edge',endMode:'edge',start:'00:00:00.000',end:rangeClock(duration??0,true)});
export function resolveRange(value:RangeSelection,duration?:number|null){
 const known=typeof duration==='number'&&Number.isFinite(duration)&&duration>0;
 if(relativeStart(value.startMode)&&relativeEnd(value.endMode))throw Error('開始と終了を同時に相対指定できません。');
 let from=value.startMode==='edge'?0:value.startMode==='custom'?parseClock(value.start):undefined;
 let to=value.endMode==='edge'?(known?duration:undefined):value.endMode==='custom'?parseClock(value.end):undefined;
 if(known&&to!==undefined&&to>duration){if(to<=Math.ceil(duration*1000)/1000+1e-9)to=duration;else throw Error('終了時刻が動画の末尾を超えています。');}
 if(relativeStart(value.startMode)){if(to===undefined)throw Error('終了時刻を確認してください。');from=Math.max(0,to-(value.startMode==='before60'?60:300));}
 if(relativeEnd(value.endMode))to=Math.min(known?duration:Infinity,from!+(value.endMode==='after60'?60:300));
 if(known&&to!==undefined&&to>duration){if(to<=Math.ceil(duration*1000)/1000+1e-9)to=duration;else throw Error('終了時刻が動画の末尾を超えています。');}
 if(from===undefined||!Number.isFinite(from)||from<0||known&&from>=duration||to!==undefined&&(!Number.isFinite(to)||to<=from))throw Error('開始より後の終了時刻を指定してください。');
 return {from,to};
}
export function rangeRequest(value:RangeSelection,duration?:number|null){const resolved=resolveRange(value,duration);return {from:resolved.from,to:value.endMode==='edge'?undefined:resolved.to};}
export function changeRangeMode(value:RangeSelection,side:'start'|'end',mode:StartMode|EndMode,duration?:number|null):RangeSelection{
 const next={...value,...(side==='start'?{startMode:mode as StartMode}:{endMode:mode as EndMode})};
 if(relativeStart(next.startMode)&&relativeEnd(next.endMode))throw Error('開始と終了を同時に相対指定できません。');
 if(mode==='custom'){try{const current=resolveRange(value,duration);if(side==='start')next.start=rangeClock(current.from);else if(current.to!==undefined)next.end=rangeClock(current.to,true);}catch{/* Keep editable text when recovering an invalid input. */}}
 return next;
}
export function moveRangeHandle(value:RangeSelection,side:'start'|'end',seconds:number,duration:number):RangeSelection{
 if(!Number.isFinite(seconds)||!Number.isFinite(duration)||duration<=0)throw Error('動画の長さを確認してください。');
 let current;try{current=resolveRange(value,duration);}catch{value=initialRange(duration);current={from:0,to:duration};}
 const gap=Math.min(.001,duration),next={...value};
 if(side==='start'){
  const limit=(relativeEnd(value.endMode)?duration:current.to??duration)-gap,from=Math.max(0,Math.min(limit,seconds));
  next.startMode=from<=0?'edge':'custom';next.start=rangeClock(from);
 }else{
  const lower=relativeStart(value.startMode)?gap:current.from+gap,to=Math.min(duration,Math.max(lower,seconds));
  next.endMode=to>=duration?'edge':'custom';next.end=rangeClock(to,true);
 }
 return next;
}
