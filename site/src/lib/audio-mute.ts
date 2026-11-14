export interface MuteRange {start:number;end:number}
export function normalizeMutes(ranges:readonly MuteRange[]):MuteRange[]{
 if(ranges.length>200000)throw Error('ミュート区間が多すぎます。');
 const sorted=ranges.map(r=>{if(!Number.isSafeInteger(r.start)||!Number.isSafeInteger(r.end)||r.start<0||r.end<=r.start)throw Error('ミュートの時刻を確認してください。');return {start:r.start,end:r.end};}).sort((a,b)=>a.start-b.start||a.end-b.end),result:MuteRange[]=[];
 for(const r of sorted){const last=result.at(-1);if(last&&r.start<=last.end)last.end=Math.max(last.end,r.end);else result.push(r);}return result;
}
export function subtractMutes(ranges:readonly MuteRange[],remove:readonly MuteRange[]):MuteRange[]{
 let result=normalizeMutes(ranges);for(const r of normalizeMutes(remove))result=result.flatMap(v=>v.end<=r.start||v.start>=r.end?[v]:[{start:v.start,end:Math.min(v.end,r.start)},{start:Math.max(v.start,r.end),end:v.end}].filter(v=>v.end>v.start));return result;
}
export function muteAt(ranges:readonly MuteRange[],ms:number){return ranges.some(r=>r.start<=ms&&ms<r.end);}
/** Interleaved PCM; timestamps refer to the original media, before cuts. */
export function mutePcm(pcm:Float32Array,startMs:number,sampleRate:number,channels:number,ranges:readonly MuteRange[]):void{
 if(!Number.isFinite(startMs)||sampleRate<=0||!Number.isInteger(channels)||channels<1||pcm.length%channels)throw Error('音声の形式を確認してください。');
 const frames=pcm.length/channels;
 for(const r of ranges){const from=Math.max(0,Math.ceil((r.start-startMs)*sampleRate/1000-1e-7)),to=Math.min(frames,Math.ceil((r.end-startMs)*sampleRate/1000-1e-7));if(to>from)pcm.fill(0,from*channels,to*channels);}
}
