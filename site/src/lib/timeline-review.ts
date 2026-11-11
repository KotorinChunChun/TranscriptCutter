import type {Cue} from './vtt';
export type TimeRange={start:number;end:number};
export type ReviewGap=TimeRange & {id:string;nextCueId:string|null;trailing:boolean};
export function reviewGaps(cues:readonly Cue[],duration?:number):ReviewGap[]{
 if(!cues.length)return [];
 const sorted=[...cues].sort((a,b)=>a.start-b.start||a.end-b.end),last=Math.max(...cues.map(c=>c.end));
 const ranges:TimeRange[]=[];let cursor=0;const limit=duration??last;
 for(const cue of sorted){if(cue.start>cursor)ranges.push({start:cursor,end:Math.min(cue.start,limit)});cursor=Math.max(cursor,cue.end);if(cursor>=limit)break;}
 if(cursor<limit)ranges.push({start:cursor,end:limit});
 return ranges.filter(g=>g.end>g.start).map(g=>({...g,id:`gap-${g.start}-${g.end}`,nextCueId:sorted.find(c=>c.start>=g.end)?.id??null,trailing:g.start>=last}));
}
export function thumbnailTimes(range:TimeRange):number[]{
 if(!Number.isSafeInteger(range.start)||!Number.isSafeInteger(range.end)||range.start<0||range.end<=range.start)throw Error('対象区間を確認してください。');
 return Array.from({length:Math.ceil((range.end-range.start)/1000)},(_,index)=>range.start+index*1000);
}
export type FrameDifference={mean:number;changed:number};
export function compareFrames(a:Uint8ClampedArray,b:Uint8ClampedArray):FrameDifference{
 if(!a.length||a.length!==b.length||a.length%4)throw Error('比較画像のサイズが一致しません。');
 let total=0,changed=0;
 for(let i=0;i<a.length;i+=4){const d=(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]))/765;total+=d;if(d>0.06)changed++;}
 return {mean:total/(a.length/4),changed:changed/(a.length/4)};
}
export function visualVerdict(differences:readonly FrameDifference[],complete:boolean){
 if(!complete||!differences.length)return {kind:'unknown' as const,label:'判定不可',mean:0,changed:0};
 const mean=Math.max(...differences.map(d=>d.mean)),changed=Math.max(...differences.map(d=>d.changed));
 const moving=mean>0.008||changed>0.002;
 return {kind:moving?'changed' as const:'small' as const,label:moving?'変化あり・残す候補':'変化小・削除候補',mean,changed};
}
