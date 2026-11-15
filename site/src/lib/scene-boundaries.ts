import {compareFrames,type TimeRange,type ReviewGap} from './timeline-review';
export type GapSplit=TimeRange & {mediaKey:string;points:number[]};
const changed=(a:Uint8ClampedArray,b:Uint8ClampedArray)=>{const d=compareFrames(a,b);return d.mean>=.045||d.changed>=.22;};
/** Coarse scan, then refine changed windows; cannot detect every brief or subtle event. */
export async function findSceneBoundaries(range:TimeRange,sample:(ms:number)=>Promise<Uint8ClampedArray>,signal:AbortSignal,onProgress:(fraction:number)=>void=()=>{}):Promise<number[]>{
 if(!Number.isSafeInteger(range.start)||!Number.isSafeInteger(range.end)||range.start<0||range.end<=range.start||range.end-range.start>600000)throw Error('映像解析は10分以内の空白区間を選択してください。');
 const check=()=>{if(signal.aborted)throw new DOMException('映像解析を中断しました。','AbortError');};
 const read=async(ms:number)=>{check();const result=await sample(ms);check();return result;};
 let previous=await read(range.start),previousTime=range.start;const points:number[]=[];
 for(let time=Math.min(range.start+500,range.end-1);time>previousTime;time=Math.min(time+500,range.end-1)){
  const frame=await read(time);
  if(changed(previous,frame)){
   let last=previous;
   for(let fine=Math.min(previousTime+50,time);fine>previousTime&&fine<=time;fine=Math.min(fine+50,time)){
    const image=fine===time?frame:await read(fine);
    if(changed(last,image)&&fine-range.start>=200&&range.end-fine>=200&&fine-(points.at(-1)??-Infinity)>=200){points.push(fine);if(points.length>=200)throw Error('変化点が多すぎます。短い区間を選択してください。');}
    last=image;if(fine===time)break;
   }
  }
  previous=frame;previousTime=time;onProgress((time-range.start)/(range.end-range.start));if(time===range.end-1)break;
 }
 onProgress(1);return points;
}
export function splitReviewGap(gap:ReviewGap,splits:readonly GapSplit[],mediaKey:string):ReviewGap[]{
 const points=[...new Set(splits.filter(s=>s.mediaKey===mediaKey&&s.start>=gap.start&&s.end<=gap.end).flatMap(s=>s.points))].filter(p=>p>gap.start&&p<gap.end).sort((a,b)=>a-b);
 const edges=[gap.start,...points,gap.end];return edges.slice(1).map((end,i)=>({...gap,start:edges[i],end,id:`gap-${edges[i]}-${end}`}));
}
export function readGapSplits(value:unknown):GapSplit[]{
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>10000)throw Error('空白分割の形式が正しくありません。');
 return value.map(s=>{
  if(!s||typeof s.mediaKey!=='string'||s.mediaKey.length>2000||!Number.isSafeInteger(s.start)||!Number.isSafeInteger(s.end)||s.start<0||s.end<=s.start||!Array.isArray(s.points)||s.points.length>200||s.points.some((p:unknown,i:number)=>!Number.isSafeInteger(p)||Number(p)<=s.start||Number(p)>=s.end||(i>0&&Number(p)<=s.points[i-1])))throw Error('空白分割の形式が正しくありません。');
  return {start:s.start,end:s.end,mediaKey:s.mediaKey,points:[...s.points]};
 });
}
