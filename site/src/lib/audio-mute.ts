export interface MuteRange {start:number;end:number}
export function normalizeMutes(ranges:readonly MuteRange[]):MuteRange[]{
 if(ranges.length>200000)throw Error('ミュート区間が多すぎます。');
 const sorted=ranges.map(r=>{if(!Number.isSafeInteger(r.start)||!Number.isSafeInteger(r.end)||r.start<0||r.end<=r.start)throw Error('ミュートの時刻を確認してください。');return {start:r.start,end:r.end};}).sort((a,b)=>a.start-b.start||a.end-b.end),result:MuteRange[]=[];
 for(const r of sorted){const last=result.at(-1);if(last&&r.start<=last.end)last.end=Math.max(last.end,r.end);else result.push(r);}return result;
}
export function subtractMutes(ranges:readonly MuteRange[],remove:readonly MuteRange[]):MuteRange[]{
 let result=normalizeMutes(ranges);for(const r of normalizeMutes(remove))result=result.flatMap(v=>v.end<=r.start||v.start>=r.end?[v]:[{start:v.start,end:Math.min(v.end,r.start)},{start:Math.max(v.start,r.end),end:v.end}].filter(v=>v.end>v.start));return result;
}
export type MuteCoverage='none'|'partial'|'full';
/** Coverage of every selected source interval, excluding gaps between selections. */
export function muteCoverage(ranges:readonly MuteRange[],selection:readonly MuteRange[]):MuteCoverage{
 const muted=normalizeMutes(ranges),selected=normalizeMutes(selection);if(!selected.length)return 'none';
 let any=false,full=true,index=0;
 for(const range of selected){
  while(index<muted.length&&muted[index].end<=range.start)index++;
  let cursor=range.start;
  for(let i=index;i<muted.length&&muted[i].start<range.end;i++){
   const part=muted[i];if(Math.min(part.end,range.end)>Math.max(part.start,range.start))any=true;
   if(part.start>cursor)full=false;
   cursor=Math.max(cursor,Math.min(range.end,part.end));if(cursor>=range.end)break;
  }
  if(cursor<range.end)full=false;
 }
 return full?'full':any?'partial':'none';
}
/** Preserve identity for no-ops so callers do not add undo entries or success notices. */
export function setMuteRanges(ranges:MuteRange[],selection:readonly MuteRange[],muted:boolean):MuteRange[]{
 const coverage=muteCoverage(ranges,selection);
 if(!selection.length||muted&&coverage==='full'||!muted&&coverage==='none')return ranges;
 return muted?normalizeMutes([...ranges,...selection]):subtractMutes(ranges,selection);
}
export function toggleMuteRanges(ranges:MuteRange[],selection:readonly MuteRange[]):MuteRange[]{
 return setMuteRanges(ranges,selection,muteCoverage(ranges,selection)!=='full');
}
export function muteAt(ranges:readonly MuteRange[],ms:number){return ranges.some(r=>r.start<=ms&&ms<r.end);}
/** Interleaved PCM; timestamps refer to the original media, before cuts. */
export function mutePcm(pcm:Float32Array,startMs:number,sampleRate:number,channels:number,ranges:readonly MuteRange[]):void{
 if(!Number.isFinite(startMs)||sampleRate<=0||!Number.isInteger(channels)||channels<1||pcm.length%channels)throw Error('音声の形式を確認してください。');
 const frames=pcm.length/channels;
 for(const r of ranges){const from=Math.max(0,Math.ceil((r.start-startMs)*sampleRate/1000-1e-7)),to=Math.min(frames,Math.ceil((r.end-startMs)*sampleRate/1000-1e-7));if(to>from)pcm.fill(0,from*channels,to*channels);}
}
